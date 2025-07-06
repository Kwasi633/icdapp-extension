import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface BuildSession {
    id: string;
    config: IcdAppConfig;
    backendCode?: string;
    frontendCode?: string;
    status: 'pending' | 'creating-project' | 'building-backend' | 'building-frontend' | 'completed' | 'error';
    error?: string;
    projectPath?: string;
}

export interface IcdAppConfig {
    frontend: 'react' | 'nextjs'; 
    backend: 'motoko' | 'rust';
    description: string;
    projectName: string;
}

export interface ServerResponse {
    success: boolean;
    backend: string;
    description: string;
    generatedCode: string;
    sessionId: string;
    timestamp: string;
}

export interface AlternativeServerResponse {
    success: boolean;
    code?: string;
    message?: string;
    data?: string;
    content?: string;
    result?: string;
    [key: string]: any;
}

export interface GeneratedFiles {
    mainFile: { filename: string; content: string };
    candidFile?: { filename: string; content: string };
    additionalFiles?: Array<{ filename: string; content: string }>;
}

export class BackendBuilder {
    private apiBaseUrl: string;
    private logger: (message: string, level?: 'info' | 'warn' | 'error') => void;

    constructor(apiBaseUrl: string, logger: (message: string, level?: 'info' | 'warn' | 'error') => void) {
        this.apiBaseUrl = apiBaseUrl;
        this.logger = logger;
    }

    async createDfxProject(session: BuildSession, workspacePath: string, token: vscode.CancellationToken): Promise<string | null> {
        try {
            const { projectName, backend, frontend } = session.config;
            const projectPath = path.join(workspacePath, projectName);

            this.logger(`🚀 Creating new ICP project: ${projectName}`);
            this.logger(`📁 Project path: ${projectPath}`);
            
            if (fs.existsSync(projectPath)) {
                this.logger(`❌ Project directory already exists: ${projectPath}`, 'error');
                return null;
            }

            const dfxCommand = this.buildDfxNewCommand(session.config);
            this.logger(`⚡ Running command: ${dfxCommand}`);

            const { stdout, stderr } = await execAsync(dfxCommand, {
                cwd: workspacePath,
                timeout: 30000 
            });

            if (!fs.existsSync(projectPath)) {
                this.logger(`❌ Project directory was not created: ${projectPath}`, 'error');
                return null;
            }

            const backendSrcPath = this.getBackendSourcePath(projectPath, backend);
            if (!fs.existsSync(backendSrcPath)) {
                this.logger(`❌ Backend source directory not found: ${backendSrcPath}`, 'error');
                return null;
            }

            this.logger(`✅ Project created successfully at: ${projectPath}`);
            return projectPath;

        } catch (error) {
            this.logger(`❌ Failed to create project: ${error}`, 'error');
            return null;
        }
    }

    private buildDfxNewCommand(config: IcdAppConfig): string {
        const { projectName, backend, frontend } = config;
        
       
        let command = `dfx new ${projectName}`;
        
        command += ` --type ${backend}`;
        
        if (frontend === 'react') {
            command += ` --frontend react`;
        } else {
            command += ` --frontend nextjs`;
        }

        return command;
    }

    private getBackendSourcePath(projectPath: string, backend: string): string {
        const projectName = path.basename(projectPath);
        return path.join(projectPath, 'src', `${projectName}_backend`);
    }

    private getMainBackendFilePath(projectPath: string, backend: string): string {
        const backendSrcPath = this.getBackendSourcePath(projectPath, backend);
        const filename = backend === 'motoko' ? 'main.mo' : 'lib.rs';
        return path.join(backendSrcPath, filename);
    }

    async buildBackendCode(session: BuildSession, token: vscode.CancellationToken): Promise<GeneratedFiles | null> {
        try {
            this.logger(`🔧 Generating ${session.config.backend} backend code for: ${session.config.projectName}`);

            const requestPayload = {
                backend: session.config.backend.toLowerCase() as 'motoko' | 'rust',
                description: session.config.description,
                projectName: session.config.projectName,
                sessionId: session.id
            };

            this.logger(`📡 Sending request to /generate-backend`);

            const response = await axios.post(`${this.apiBaseUrl}/generate-backend`, requestPayload, {
                timeout: 180000,
                headers: {
                    'Content-Type': 'application/json'
                },
                signal: token.isCancellationRequested ? AbortSignal.timeout(0) : undefined
            });

            this.logger(`📥 Response status: ${response.status}`);

            const generatedFiles = this.parseAIResponse(response.data, session.config.backend);
            
            if (generatedFiles) {
                session.backendCode = generatedFiles.mainFile.content;
                this.logger(`💾 Backend code stored in session for frontend builder`);
                
                this.logger(`✅ Backend code generated successfully`);
                return generatedFiles;
            } else {
                this.logger(`❌ Failed to parse AI response`, 'error');
                return null;
            }

        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response) {
                    this.logger(`❌ Backend API error ${error.response.status}: ${JSON.stringify(error.response.data)}`, 'error');
                } else if (error.request) {
                    this.logger(`❌ Backend API request failed: ${error.message}`, 'error');
                } else {
                    this.logger(`❌ Backend API error: ${error.message}`, 'error');
                }
            } else {
                this.logger(`❌ Backend code generation failed: ${error}`, 'error');
            }
            return null;
        }
    }

    private parseAIResponse(responseData: any, backend: string): GeneratedFiles | null {
        try {
            let generatedCode: string | null = null;

            if (responseData && typeof responseData === 'object') {
                const serverResponse = responseData as ServerResponse & AlternativeServerResponse;
                
                if (serverResponse.generatedCode && typeof serverResponse.generatedCode === 'string') {
                    generatedCode = serverResponse.generatedCode;
                } else {
                    const alternativeKeys = ['code', 'message', 'data', 'content', 'result'];
                    for (const key of alternativeKeys) {
                        if (serverResponse[key] && typeof serverResponse[key] === 'string') {
                            generatedCode = serverResponse[key] as string;
                            break;
                        }
                    }
                }
            } else if (typeof responseData === 'string') {
                generatedCode = responseData;
            }

            if (!generatedCode) {
                return null;
            }

            return this.extractFilesFromResponse(generatedCode, backend);

        } catch (error) {
            this.logger(`❌ Error parsing AI response: ${error}`, 'error');
            return null;
        }
    }

    private extractFilesFromResponse(content: string, backend: string): GeneratedFiles {
        const files: GeneratedFiles = {
            mainFile: {
                filename: backend === 'motoko' ? 'main.mo' : 'lib.rs',
                content: ''
            }
        };

        const cleanContent = this.cleanGeneratedCode(content);

        const extractedFiles = this.extractMarkdownSections(cleanContent);
        
        if (extractedFiles.size > 1) {
            for (const [filename, fileContent] of extractedFiles) {
                if (this.isMainFile(filename, backend)) {
                    files.mainFile = { filename, content: fileContent };
                } else if (filename.endsWith('.did')) {
                    files.candidFile = { filename, content: fileContent };
                } else {
                    if (!files.additionalFiles) {
                        files.additionalFiles = [];
                    }
                    files.additionalFiles.push({ filename, content: fileContent });
                }
            }
        } else {
            files.mainFile.content = cleanContent;
        }

        return files;
    }

    private isMainFile(filename: string, backend: string): boolean {
        if (backend === 'motoko') {
            return filename.endsWith('.mo') && (filename === 'main.mo' || filename.includes('main'));
        } else {
            return filename.endsWith('.rs') && (filename === 'lib.rs' || filename.includes('lib'));
        }
    }

    async replaceBackendCode(projectPath: string, generatedFiles: GeneratedFiles, config: IcdAppConfig): Promise<boolean> {
        try {
            const backendSrcPath = this.getBackendSourcePath(projectPath, config.backend);
            
            const mainFilePath = path.join(backendSrcPath, generatedFiles.mainFile.filename);
            await this.writeFileWithBackup(mainFilePath, generatedFiles.mainFile.content);

            if (generatedFiles.candidFile) {
                const candidPath = path.join(backendSrcPath, generatedFiles.candidFile.filename);
                await this.writeFileWithBackup(candidPath, generatedFiles.candidFile.content);
                this.logger(`✅ Created Candid interface: ${generatedFiles.candidFile.filename}`);
            }

            if (generatedFiles.additionalFiles) {
                for (const file of generatedFiles.additionalFiles) {
                    const filePath = path.join(backendSrcPath, file.filename);
                    await this.writeFileWithBackup(filePath, file.content);
                    this.logger(`✅ Created additional file: ${file.filename}`);
                }
            }

            return true;
        } catch (error) {
            this.logger(`❌ Failed to replace backend code: ${error}`, 'error');
            return false;
        }
    }

    private async writeFileWithBackup(filePath: string, content: string): Promise<void> {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(filePath, content, 'utf8');
        } catch (error) {
            throw new Error(`Failed to write file ${filePath}: ${error}`);
        }
    }

    async updateDfxConfig(projectPath: string, config: IcdAppConfig): Promise<boolean> {
        try {
            const dfxConfigPath = path.join(projectPath, 'dfx.json');
            
            if (!fs.existsSync(dfxConfigPath)) {
                this.logger(`❌ dfx.json not found at: ${dfxConfigPath}`, 'error');
                return false;
            }

            const dfxConfigContent = fs.readFileSync(dfxConfigPath, 'utf8');
            const dfxConfig = JSON.parse(dfxConfigContent);
            
            this.logger(`✅ dfx.json configuration validated`);
            return true;
        } catch (error) {
            this.logger(`❌ Failed to update dfx.json: ${error}`, 'error');
            return false;
        }
    }

    async createFullBackend(session: BuildSession, workspacePath: string, token: vscode.CancellationToken): Promise<boolean> {
        try {
            session.status = 'creating-project';
            const projectPath = await this.createDfxProject(session, workspacePath, token);
            if (!projectPath) {
                session.status = 'error';
                session.error = 'Failed to create project';
                return false;
            }
            session.projectPath = projectPath;

            session.status = 'building-backend';
            const generatedFiles = await this.buildBackendCode(session, token);
            if (!generatedFiles) {
                session.status = 'error';
                session.error = 'Failed to generate backend code';
                return false;
            }

            const replaceSuccess = await this.replaceBackendCode(projectPath, generatedFiles, session.config);
            if (!replaceSuccess) {
                session.status = 'error';
                session.error = 'Failed to replace backend code';
                return false;
            }

            const configSuccess = await this.updateDfxConfig(projectPath, session.config);
            if (!configSuccess) {
                this.logger(`⚠️ dfx.json update had issues, but continuing...`, 'warn');
            }

            session.status = 'completed';
            this.logger(`🎉 Backend creation completed successfully!`);
            return true;

        } catch (error) {
            session.status = 'error';
            session.error = `Backend creation failed: ${error}`;
            this.logger(`❌ Backend creation failed: ${error}`, 'error');
            return false;
        }
    }

    private cleanGeneratedCode(rawCode: string): string {
        try {
            let formattedCode = rawCode;

            if (formattedCode.includes('\\n')) {
                formattedCode = formattedCode
                    .replace(/\\n/g, '\n')
                    .replace(/\\t/g, '\t')
                    .replace(/\\r/g, '\r')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\');
            }

            formattedCode = formattedCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

            if ((formattedCode.startsWith('"') && formattedCode.endsWith('"')) ||
                (formattedCode.startsWith("'") && formattedCode.endsWith("'"))) {
                formattedCode = formattedCode.slice(1, -1);
            }

            formattedCode = this.removeMarkdownCodeBlocks(formattedCode);

            formattedCode = formattedCode.trim();

            if (!formattedCode.endsWith('\n')) {
                formattedCode += '\n';
            }

            return formattedCode;
        } catch (error) {
            this.logger(`⚠️ Error cleaning generated code: ${error}`, 'warn');
            return rawCode;
        }
    }

    private removeMarkdownCodeBlocks(code: string): string {
        const codeBlockRegex = /```(?:motoko|rust|mo|rs)?\n?([\s\S]*?)```/g;
        const matches = code.match(codeBlockRegex);
        
        if (matches && matches.length > 0) {
            const match = matches[0];
            const content = match.replace(/```(?:motoko|rust|mo|rs)?\n?/, '').replace(/```$/, '');
            return content;
        }
        
        return code;
    }

    private extractMarkdownSections(content: string): Map<string, string> {
        const files = new Map<string, string>();

        const codeBlocks = content.match(/```(?:motoko|rust|candid|toml)\n([\s\S]*?)```/g);
        
        if (codeBlocks) {
            for (const block of codeBlocks) {
                if (block.includes('```motoko')) {
                    const code = block.replace(/```motoko\n?/, '').replace(/```$/, '').trim();
                    files.set('main.mo', code);
                } else if (block.includes('```rust')) {
                    const code = block.replace(/```rust\n?/, '').replace(/```$/, '').trim();
                    files.set('lib.rs', code);
                } else if (block.includes('```candid')) {
                    const code = block.replace(/```candid\n?/, '').replace(/```$/, '').trim();
                    files.set('backend.did', code);
                } else if (block.includes('```toml')) {
                    const code = block.replace(/```toml\n?/, '').replace(/```$/, '').trim();
                    files.set('Cargo.toml', code);
                }
            }
        }

        if (files.size === 0) {
            files.set('main', content);
        }

        return files;
    }

    generateDeploymentInstructions(projectPath: string, config: IcdAppConfig): string {
        const projectName = path.basename(projectPath);
        
        return `# ${projectName} - Deployment Instructions

## Local Development

1. **Navigate to project directory:**
   \`\`\`bash
   cd ${projectPath}
   \`\`\`

2. **Start local replica:**
   \`\`\`bash
   dfx start --background
   \`\`\`

3. **Deploy to local replica:**
   \`\`\`bash
   dfx deploy
   \`\`\`

4. **Test your canister:**
   \`\`\`bash
   dfx canister call ${projectName}_backend [method_name]
   \`\`\`

## Production Deployment

1. **Deploy to IC mainnet:**
   \`\`\`bash
   dfx deploy --network ic
   \`\`\`

## Project Structure
\`\`\`
${projectName}/
├── dfx.json                    # DFX configuration
├── src/
│   ├── ${projectName}_backend/ # Backend canister
${config.backend === 'rust' ? '│   │   ├── Cargo.toml         # Rust dependencies' : ''}
│   │   ├── ${config.backend === 'motoko' ? 'main.mo' : 'lib.rs'}          # Main backend code
│   │   └── *.did              # Candid interface
│   └── ${projectName}_frontend/# Frontend application
└── README.md
\`\`\`

Generated by icdApp VS Code Extension`;
    }

    validateProjectStructure(projectPath: string, config: IcdAppConfig): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        try {
            if (!fs.existsSync(path.join(projectPath, 'dfx.json'))) {
                errors.push('dfx.json not found');
            }

            const backendSrcPath = this.getBackendSourcePath(projectPath, config.backend);
            if (!fs.existsSync(backendSrcPath)) {
                errors.push(`Backend source directory not found: ${backendSrcPath}`);
            }

            const mainFilePath = this.getMainBackendFilePath(projectPath, config.backend);
            if (!fs.existsSync(mainFilePath)) {
                errors.push(`Main backend file not found: ${mainFilePath}`);
            }

            const projectName = path.basename(projectPath);
            const frontendPath = path.join(projectPath, 'src', `${projectName}_frontend`);
            if (!fs.existsSync(frontendPath)) {
                errors.push(`Frontend directory not found: ${frontendPath}`);
            }

        } catch (error) {
            errors.push(`Validation error: ${error}`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}