import { z } from 'zod';
import { defineTabTool } from './tool.js';

const uploadFile = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_file_upload',
    title: 'Upload files',
    description: 'Upload one or multiple files',
    inputSchema: z.object({
      paths: z.array(z.string()).describe('The absolute paths to the files to upload. Can be a single file or multiple files.'),
    }),
    type: 'destructive',
  },
  handle: async (tab: any, params: any, response: any) => {
    response.setIncludeSnapshot();
    const modalState = tab.modalStates().find((state: any) => state.type === 'fileChooser');
    if (!modalState)
      throw new Error('No file chooser visible');
    response.addCode(`await fileChooser.setFiles(${JSON.stringify(params.paths)})`);
    tab.clearModalState(modalState);
    await tab.waitForCompletion(async () => {
      await modalState.fileChooser.setFiles(params.paths);
    });
  },
  clearsModalState: 'fileChooser',
});

export default [uploadFile];
