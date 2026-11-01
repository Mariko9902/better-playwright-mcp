export function defineTool(tool: any) {
  return tool;
}

export function defineTabTool(tool: any) {
  return {
    ...tool,
    handle: async (context: any, params: any, response: any) => {
      const tab = context.currentTabOrDie();
      await tab.waitUntilReady();
      const modalStates = tab.modalStates().map((state: any) => state.type);
      if (tool.clearsModalState && !modalStates.includes(tool.clearsModalState))
        response.addError(`Error: The tool "${tool.schema.name}" can only be used when there is related modal state present.\n` + tab.modalStatesMarkdown().join('\n'));
      else if (!tool.clearsModalState && modalStates.length)
        response.addError(`Error: Tool "${tool.schema.name}" does not handle the modal state.\n` + tab.modalStatesMarkdown().join('\n'));
      else
        return tool.handle(tab, params, response);
    },
  };
}
