import { z } from 'zod';

import { logUnhandledError } from '../utils/log.js';
import { defineTool } from './tool.js';

const batchStepSchema = z.object({
  id: z.string().optional().describe('Optional stable step id used by dependsOn and result summaries'),
  tool: z.string().describe('Tool name to call'),
  args: z.any().optional().describe('Tool arguments'),
  dependsOn: z.array(z.string()).optional().describe('Step ids that must succeed before this step can run'),
  executionMode: z.enum(['auto', 'sequential', 'parallel']).optional().describe('Execution strategy hint. Only readOnly steps may run in parallel.'),
  retryCount: z.number().int().min(0).max(3).optional().describe('How many times to retry transient step failures'),
  continueOnError: z.boolean().optional().describe('Whether to continue executing later steps when this step fails'),
  includeSnapshotOnError: z.boolean().optional().describe('Whether to include a final snapshot when this step fails'),
  includeDiagnosticsOnError: z.boolean().optional().describe('Whether to collect screenshot/console/network diagnostics when this step fails'),
});

const deviceModeAllowlist = new Set([
  'browser_set_device_mode',
  'browser_batch',
  'browser_close',
  'browser_restart',
  'browser_snapshot',
  'browser_tabs',
]);

const parallelSafeToolNames = new Set([
  'browser_console_messages',
  'browser_debug_summary',
  'browser_get_url',
  'browser_network_requests',
  'browser_outline',
  'browser_search_snapshot',
  'browser_snapshot',
  'browser_wait_for',
  'browser_wait_for_any',
  'browser_wait_for_api',
  'browser_wait_for_response',
  'browser_wait_for_selector',
  'browser_wait_for_text',
  'browser_wait_for_url_contains',
]);

const MAX_ERROR_LENGTH = 2000;

const batch = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_batch',
    title: 'Batch tool calls',
    description: 'Execute multiple tool calls in a single request to reduce round-trips. Steps support ids, dependencies, retries, and limited parallel execution for explicitly safe read-only tools.',
    inputSchema: z.object({
      steps: z.array(batchStepSchema).min(1),
      maxConcurrency: z.number().int().min(1).max(8).optional().describe('Maximum number of parallel readOnly steps to run at once'),
      includeSnapshot: z.boolean().optional().describe('Whether to include a snapshot at the end'),
      continueOnError: z.boolean().optional().describe('Whether to continue executing later steps after a failure'),
      defaultRetryCount: z.number().int().min(0).max(3).optional().describe('Default retry count for transient step failures'),
      includeSnapshotOnError: z.boolean().optional().describe('Whether to include a final snapshot when a step fails'),
      includeDiagnosticsOnError: z.boolean().optional().describe('Whether to collect screenshot/console/network diagnostics when a step fails'),
    }),
    type: 'destructive',
  },
  handle: async (context: any, params: any, response: any) => {
    const tools: any[] = context?.tools || [];
    const includeSnapshotRequested = Boolean(params.includeSnapshot);
    const defaultRetryCount = params.defaultRetryCount ?? 0;
    const continueOnErrorDefault = Boolean(params.continueOnError);
    const includeSnapshotOnErrorDefault = params.includeSnapshotOnError !== false;
    const includeDiagnosticsOnErrorDefault = params.includeDiagnosticsOnError !== false;
    const maxConcurrency = Math.max(1, params.maxConcurrency ?? 4);
    const outcomes = new Map<string, any>();
    let hasFailures = false;

    if (includeSnapshotRequested)
      response.setIncludeSnapshot();

    const preparedSteps = params.steps.map((step: any, index: number) => {
      const rawToolName = String(step.tool || '');
      if (!rawToolName)
        throw new Error(`browser_batch step[${index}]: missing tool`);
      const toolName = normalizeToolName(rawToolName, tools);
      if (toolName === 'browser_batch')
        throw new Error(`browser_batch step[${index}]: cannot call browser_batch`);
      const tool = tools.find((t: any) => t?.schema?.name === toolName);
      if (!tool)
        throw new Error(`browser_batch step[${index}]: tool not found: ${rawToolName}${toolName !== rawToolName ? ` (normalized=${toolName})` : ''}`);

      let parsed: any;
      try {
        parsed = tool.schema.inputSchema.parse(normalizeStepArgs(step.args, index, toolName));
      } catch (e: any) {
        const fullMsg = e?.message || String(e);
        const capped = capError(fullMsg);
        throw new Error(`browser_batch step[${index}] ${toolName}: invalid args: ${capped}`);
      }

      return {
        id: String(step.id ?? `step_${index}`),
        index,
        rawToolName,
        toolName,
        tool,
        parsed,
        dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map((id: any) => String(id)) : [],
        executionMode: step.executionMode ?? 'auto',
        retryCount: step.retryCount ?? defaultRetryCount,
        continueOnError: step.continueOnError ?? continueOnErrorDefault,
        includeSnapshotOnError: step.includeSnapshotOnError ?? includeSnapshotOnErrorDefault,
        includeDiagnosticsOnError: step.includeDiagnosticsOnError ?? includeDiagnosticsOnErrorDefault,
      };
    });

    const stepIdSet = new Set<string>();
    for (const step of preparedSteps) {
      if (stepIdSet.has(step.id))
        throw new Error(`browser_batch duplicate step id: ${step.id}`);
      stepIdSet.add(step.id);
    }
    for (const step of preparedSteps) {
      for (const depId of step.dependsOn) {
        if (!stepIdSet.has(depId))
          throw new Error(`browser_batch step[${step.index}] ${step.toolName}: unknown dependsOn step id: ${depId}`);
      }
    }

    const pending = new Set(preparedSteps.map((step: any) => step.id));
    let stopScheduling = false;

    const runStep = async (step: any) => {
      const start = Date.now();
      const summaryPrefix = `step[${step.index}] id=${step.id} tool=${step.toolName}`;
      const dependencyText = step.dependsOn.length ? ` dependsOn=${JSON.stringify(step.dependsOn)}` : '';
      response.addResult(`- ${summaryPrefix}: start${dependencyText}`);

      for (let attempt = 0; attempt <= step.retryCount; attempt++) {
        response.addResult(`- ${summaryPrefix}: attempt ${attempt + 1}/${step.retryCount + 1}`);
        let stepArtifacts: ReturnType<typeof createStepArtifacts> | undefined;
        try {
          const currentMode = context?.deviceMode?.();
          const modeRequired = context?.deviceModeRequired?.();
          if (modeRequired && !currentMode && !isDeviceModeAllowed(step.toolName, step.parsed))
            throw new Error('Device mode is required. Call browser_set_device_mode(mode=H5|PC) first, or pass mode to browser_navigate.');

          stepArtifacts = createStepArtifacts();
          await step.tool.handle(context, step.parsed, stepArtifacts);
          if (stepArtifacts.error)
            throw new Error(stepArtifacts.error);
          return {
            step,
            status: 'ok',
            durationMs: Date.now() - start,
            attempts: attempt + 1,
            artifacts: stepArtifacts,
          };
        } catch (e: any) {
          const fullMsg = e?.message || String(e);
          const capped = capError(fullMsg);
          const shouldRetry = attempt < step.retryCount && isRetryableStepError(fullMsg);
          if (shouldRetry) {
            response.addResult(`- ${summaryPrefix}: retrying after error: ${capped}`);
            await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
            continue;
          }

          return {
            step,
            status: 'failed',
            durationMs: Date.now() - start,
            attempts: attempt + 1,
            artifacts: stepArtifacts,
            error: capped,
            fullError: fullMsg,
          };
        }
      }

      return {
        step,
        status: 'failed',
        durationMs: Date.now() - start,
        attempts: step.retryCount + 1,
        error: 'Unknown batch execution failure',
      };
    };

    while (pending.size) {
      const ready = preparedSteps.filter((step: any) => pending.has(step.id) && step.dependsOn.every((depId: string) => outcomes.has(depId)));
      if (!ready.length) {
        const unresolved = preparedSteps.filter((step: any) => pending.has(step.id)).map((step: any) => ({
          id: step.id,
          dependsOn: step.dependsOn,
        }));
        throw new Error(`browser_batch deadlock detected. unresolved=${JSON.stringify(unresolved)}`);
      }

      const skipped = ready.filter((step: any) => step.dependsOn.some((depId: string) => {
        const depOutcome = outcomes.get(depId);
        return depOutcome && depOutcome.status !== 'ok';
      }));
      for (const step of skipped) {
        const failedDeps = step.dependsOn.filter((depId: string) => outcomes.get(depId)?.status !== 'ok');
        const outcome = {
          step,
          status: 'skipped',
          durationMs: 0,
          attempts: 0,
          error: `Skipped because dependencies did not succeed: ${failedDeps.join(', ')}`,
        };
        outcomes.set(step.id, outcome);
        pending.delete(step.id);
        hasFailures = true;
        response.addResult(`- step[${step.index}] id=${step.id} tool=${step.toolName}: skipped (${outcome.error})`);
      }
      if (stopScheduling)
        break;

      const runnable = ready.filter((step: any) => pending.has(step.id));
      if (!runnable.length)
        continue;

      const parallelReady = runnable.filter((step: any) => isParallelStep(step));
      const sequentialStep = runnable.find((step: any) => !isParallelStep(step));
      const batchToRun = parallelReady.length ? parallelReady.slice(0, maxConcurrency) : [sequentialStep];
      const results = parallelReady.length
        ? await Promise.all(batchToRun.map((step: any) => runStep(step)))
        : [await runStep(batchToRun[0])];

      results.sort((a: any, b: any) => a.step.index - b.step.index);
      for (const result of results) {
        const { step } = result;
        pending.delete(step.id);
        outcomes.set(step.id, result);
        result.artifacts?.flush(response);

        if (result.status === 'ok') {
          response.addResult(`- step[${step.index}] id=${step.id} tool=${step.toolName}: ok (${result.durationMs}ms, attempts=${result.attempts})`);
          continue;
        }

        if (step.includeSnapshotOnError)
          response.setIncludeSnapshot();
        if (step.includeDiagnosticsOnError)
          await appendStepDiagnostics(context, response, step.index, step.toolName);

        hasFailures = true;
        response.addResult(`- step[${step.index}] id=${step.id} tool=${step.toolName}: failed (${result.durationMs}ms, attempts=${result.attempts})`);
        response.addResult(`- step[${step.index}] id=${step.id} error: ${result.error}`);

        if (!step.continueOnError) {
          response.addError(`browser_batch stopped at step[${step.index}] id=${step.id} tool=${step.toolName}. error=${result.error}`);
          stopScheduling = true;
          break;
        }
      }
    }

    if (stopScheduling) {
      for (const step of preparedSteps.filter((item: any) => pending.has(item.id))) {
        pending.delete(step.id);
        outcomes.set(step.id, {
          step,
          status: 'not_run',
          durationMs: 0,
          attempts: 0,
          error: 'Not executed because browser_batch stopped after an earlier failure',
        });
        response.addResult(`- step[${step.index}] id=${step.id} tool=${step.toolName}: not_run (blocked by earlier failure)`);
      }
    }

    if (hasFailures)
      response.addError('browser_batch completed with failed steps. See step logs above.');

    response.addResult('batch_step_summary:');
    for (const step of preparedSteps) {
      const outcome = outcomes.get(step.id);
      response.addResult(`- step[${step.index}] id=${step.id} tool=${step.toolName} status=${outcome?.status ?? 'unknown'} attempts=${outcome?.attempts ?? 0} durationMs=${outcome?.durationMs ?? 0}${step.dependsOn.length ? ` dependsOn=${JSON.stringify(step.dependsOn)}` : ''}${outcome?.error ? ` error=${outcome.error}` : ''}`);
    }
  },
});

function createStepArtifacts() {
  const stepResults: string[] = [];
  const stepCode: string[] = [];
  const stepImages: any[] = [];
  let includeSnapshot = false;
  let includeTabs = false;
  let stepError: string | undefined;

  return {
    addResult: (r: string) => { stepResults.push(r); },
    addError: (e: string) => {
      stepResults.push(e);
      stepError = e;
    },
    addCode: (c: string) => { stepCode.push(c); },
    addImage: (image: any) => { stepImages.push(image); },
    setIncludeSnapshot: () => { includeSnapshot = true; },
    setIncludeTabs: () => { includeTabs = true; },
    flush: (response: any) => {
      for (const result of stepResults)
        response.addResult(result);
      for (const line of stepCode)
        response.addCode(line);
      for (const image of stepImages)
        response.addImage(image);
      if (includeSnapshot)
        response.setIncludeSnapshot();
      if (includeTabs)
        response.setIncludeTabs();
    },
    get error() {
      return stepError;
    },
  };
}

function normalizeToolName(rawToolName: string, tools: any[]) {
  if (tools.some((tool: any) => tool?.schema?.name === rawToolName))
    return rawToolName;
  const normalizedCandidates = [
    rawToolName.replace(/^mcp\d+_/, ''),
    rawToolName.replace(/^functions\./, ''),
    rawToolName.replace(/^better-playwright\./, ''),
    rawToolName.split('.').pop() || rawToolName,
  ].filter(Boolean);
  for (const candidate of normalizedCandidates) {
    if (tools.some((tool: any) => tool?.schema?.name === candidate))
      return candidate;
  }
  return rawToolName;
}

function normalizeStepArgs(rawArgs: any, stepIndex: number, toolName: string) {
  if (rawArgs === undefined || rawArgs === null)
    return {};
  if (typeof rawArgs !== 'string')
    return rawArgs;

  const trimmed = rawArgs.trim();
  if (!trimmed)
    return {};

  try {
    return JSON.parse(trimmed);
  } catch (error: any) {
    const parseError = capError(error?.message || String(error));
    throw new Error(
      `browser_batch step[${stepIndex}] ${toolName}: args provided as string but JSON parsing failed. `
      + `Pass an object directly, or provide a valid JSON string. parseError=${parseError}`,
    );
  }
}

function isParallelStep(step: any) {
  return step.executionMode === 'parallel'
    && step.tool?.schema?.type === 'readOnly'
    && parallelSafeToolNames.has(step.toolName);
}

function isDeviceModeAllowed(toolName: string, parsedArgs: any) {
  if (deviceModeAllowlist.has(toolName))
    return true;
  if (toolName === 'browser_navigate')
    return true;
  if (toolName !== 'browser_tabs')
    return false;
  return ['list', 'new', 'close', 'select'].includes(String(parsedArgs?.action));
}

function isRetryableStepError(message: string) {
  return message.includes('Ref not found')
    || message.includes('element was removed')
    || message.includes('Execution context was destroyed')
    || message.includes('Target page, context or browser has been closed')
    || message.includes('TimeoutError')
    || message.includes('navigation')
    || message.includes('Another browser context is being closed')
    || message.includes('Failed to launch the browser process');
}

function capError(message: string) {
  return message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH - 14) + '…(truncated)' : message;
}

async function appendStepDiagnostics(context: any, response: any, stepIndex: number, toolName: string) {
  const tab = context?.currentTab?.();
  if (!tab)
    return;

  const fileName = await tab.context.outputFile(`batch-step-${stepIndex}-${toolName}-failure-${Date.now()}.png`);
  await tab.page.screenshot({ path: fileName, fullPage: true }).catch(logUnhandledError);
  response.addResult(`failure_screenshot(step ${stepIndex} ${toolName}): ${fileName}`);

  const consoleTail = tab.debugConsoleTail(5);
  if (consoleTail.length) {
    response.addResult(`console_tail(step ${stepIndex} ${toolName}):`);
    for (const message of consoleTail)
      response.addResult(`- ${message.toString()}`);
  }

  const networkTail = tab.debugNetworkTail(10, false);
  if (networkTail.length) {
    response.addResult(`network_tail(step ${stepIndex} ${toolName}):`);
    for (const [req, res] of networkTail) {
      const line = res
        ? `[${req.method()}] ${req.url()} => [${res.status()}] ${res.statusText()}`
        : `[${req.method()}] ${req.url()} => (pending)`;
      response.addResult(`- ${line}`);
    }
  }
}

export default [batch];
