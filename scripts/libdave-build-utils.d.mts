export function patchLibdaveCMakeContent(content: string): string;
export function patchLibdaveCMakeLists(sourceDir: string): Promise<void>;
export function getLibdaveEmscriptenToolchainFile(emsdk: string): string;
export function getLibdaveWasmConfigureArgs(emsdk: string): string[];
export function getLibdaveWasmBuildArgs(): string[];
