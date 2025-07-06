import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { BuildSession, IcdAppConfig } from './backendBuilder';

export interface GeneratedFrontendFiles {
    appFile: { filename: string; content: string };
    stylesFile?: { filename: string; content: string };
    additionalFiles?: Array<{ filename: string; content: string }>;
}

export class FrontendBuilder {
    private apiBaseUrl: string;
    private logger: (message: string, level?: 'info' | 'warn' | 'error') => void;

    constructor(apiBaseUrl: string, logger: (message: string, level?: 'info' | 'warn' | 'error') => void) {
        this.apiBaseUrl = apiBaseUrl;
        this.logger = logger;
    }

    private getFrontendSourcePath(projectPath: string): string {
        const projectName = path.basename(projectPath);
        return path.join(projectPath, 'src', `${projectName}_frontend`, 'src');
    }

    private getFrontendFilePaths(projectPath: string, frontend: string): {
        appFile: string;
        stylesFile: string;
        indexFile?: string;
    } {
        const frontendSrcPath = this.getFrontendSourcePath(projectPath);

        if (frontend === 'nextjs') {
            return {
                appFile: path.join(frontendSrcPath, 'app', 'page.tsx'),
                stylesFile: path.join(frontendSrcPath, 'app', 'globals.css'),
                indexFile: path.join(frontendSrcPath, 'app', 'layout.tsx')
            };
        } else {
            return {
                appFile: path.join(frontendSrcPath, 'App.jsx'),
                stylesFile: path.join(frontendSrcPath, 'index.scss')
            };
        }
    }

    async buildFrontendCode(session: BuildSession, token: vscode.CancellationToken): Promise<GeneratedFrontendFiles | null> {
        try {
            this.logger(`🎨 Generating ${session.config.frontend} frontend code for: ${session.config.projectName}`);

            const requestPayload = {
                frontend: session.config.frontend.toLowerCase() === 'react' ? 'reactjs' : 'nextjs',
                backendCode: session.backendCode || '',
                description: session.config.description,
                sessionId: session.id
            };

            if (!requestPayload.frontend || !requestPayload.description || !requestPayload.sessionId) {
                this.logger(`❌ Missing required fields for frontend generation`, 'error');
                return null;
            }

            this.logger(`📡 Sending request to /generate-frontend`);

            const response = await axios.post(`${this.apiBaseUrl}/generate-frontend`, requestPayload, {
                timeout: 120000,
                headers: {
                    'Content-Type': 'application/json'
                },
                signal: token.isCancellationRequested ? AbortSignal.timeout(0) : undefined
            });

            this.logger(`📥 Response status: ${response.status}`);

            const generatedFiles = this.parseAIFrontendResponse(response.data, session.config.frontend);
            if (generatedFiles) {
                this.logger(`✅ Frontend code generated successfully`);
                return generatedFiles;
            } else {
                this.logger(`❌ Failed to parse AI frontend response`, 'error');
                return null;
            }

        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response) {
                    this.logger(`❌ Frontend API error ${error.response.status}: ${JSON.stringify(error.response.data)}`, 'error');
                } else if (error.request) {
                    this.logger(`❌ Frontend API request failed: ${error.message}`, 'error');
                } else {
                    this.logger(`❌ Frontend API error: ${error.message}`, 'error');
                }
            } else {
                this.logger(`❌ Frontend code generation failed: ${error}`, 'error');
            }
            return null;
        }
    }

    private parseAIFrontendResponse(responseData: any, frontend: string): GeneratedFrontendFiles | null {
        try {
            let generatedCode: string | null = null;

            if (responseData && typeof responseData === 'object') {
                if (responseData.code && typeof responseData.code === 'string') {
                    generatedCode = responseData.code;
                } else if (responseData.generatedCode && typeof responseData.generatedCode === 'string') {
                    generatedCode = responseData.generatedCode;
                } else {
                    const alternativeKeys = ['content', 'data', 'result', 'message'];
                    for (const key of alternativeKeys) {
                        if (responseData[key] && typeof responseData[key] === 'string') {
                            generatedCode = responseData[key] as string;
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

            return this.extractFrontendFilesFromResponse(generatedCode, frontend);

        } catch (error) {
            this.logger(`❌ Error parsing AI frontend response: ${error}`, 'error');
            return null;
        }
    }

    private extractFrontendFilesFromResponse(content: string, frontend: string): GeneratedFrontendFiles {
        const files: GeneratedFrontendFiles = {
            appFile: {
                filename: frontend === 'nextjs' ? 'page.tsx' : 'App.jsx',
                content: ''
            }
        };

        const cleanContent = this.cleanGeneratedCode(content);

        const extractedFiles = this.extractMarkdownSections(cleanContent);

        if (extractedFiles.size > 1) {
            for (const [filename, fileContent] of extractedFiles) {
                if (this.isMainAppFile(filename, frontend)) {
                    files.appFile = { filename, content: fileContent };
                } else if (this.isStylesFile(filename)) {
                    files.stylesFile = { filename, content: fileContent };
                } else {
                    if (!files.additionalFiles) {
                        files.additionalFiles = [];
                    }
                    files.additionalFiles.push({ filename, content: fileContent });
                }
            }
        } else {
            files.appFile.content = cleanContent;
        }

        return files;
    }

    private isMainAppFile(filename: string, frontend: string): boolean {
        if (frontend === 'nextjs') {
            return filename.includes('page.') || filename.includes('App.') ||
                   filename.endsWith('.tsx') || filename.endsWith('.jsx');
        } else {
            return filename.includes('App.') || filename.includes('app.') ||
                   (filename.endsWith('.jsx') || filename.endsWith('.tsx'));
        }
    }

    private isStylesFile(filename: string): boolean {
        return filename.endsWith('.css') || filename.endsWith('.scss') ||
               filename.endsWith('.sass') || filename.includes('style');
    }

    async replaceFrontendCode(projectPath: string, generatedFiles: GeneratedFrontendFiles, config: IcdAppConfig): Promise<boolean> {
        try {
            const frontendPaths = this.getFrontendFilePaths(projectPath, config.frontend);

            await this.writeFile(frontendPaths.appFile, generatedFiles.appFile.content);
            this.logger(`✅ Replaced main frontend file: ${generatedFiles.appFile.filename}`);

            if (generatedFiles.stylesFile) {
                await this.writeFile(frontendPaths.stylesFile, generatedFiles.stylesFile.content);
                this.logger(`✅ Replaced styles file: ${generatedFiles.stylesFile.filename}`);
            }

            if (generatedFiles.additionalFiles) {
                const frontendSrcPath = this.getFrontendSourcePath(projectPath);
                for (const file of generatedFiles.additionalFiles) {
                    const filePath = path.join(frontendSrcPath, file.filename);
                    await this.writeFile(filePath, file.content);
                    this.logger(`✅ Created additional frontend file: ${file.filename}`);
                }
            }

            return true;

        } catch (error) {
            this.logger(`❌ Failed to replace frontend code: ${error}`, 'error');
            return false;
        }
    }

    private async writeFile(filePath: string, content: string): Promise<void> {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(filePath, content, 'utf8');

        } catch (error) {
            throw new Error(`Failed to write frontend file ${filePath}: ${error}`);
        }
    }

    async updatePackageJson(projectPath: string, config: IcdAppConfig): Promise<boolean> {
        try {
            const projectName = path.basename(projectPath);
            const frontendPath = path.join(projectPath, 'src', `${projectName}_frontend`);
            const packageJsonPath = path.join(frontendPath, 'package.json');

            if (!fs.existsSync(packageJsonPath)) {
                this.logger(`⚠️ package.json not found, creating new one`, 'warn');
                const newPackageJson = this.generatePackageJson(config, projectName);
                fs.writeFileSync(packageJsonPath, newPackageJson, 'utf8');
                this.logger(`✅ Created new package.json`);
                return true;
            }

            const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
            const packageJson = JSON.parse(packageJsonContent);

            const icpDependencies = {
                "@dfinity/agent": "^0.20.0",
                "@dfinity/candid": "^0.20.0",
                "@dfinity/principal": "^0.20.0",
                "@dfinity/auth-client": "^0.20.0"
            };

            packageJson.dependencies = {
                ...packageJson.dependencies,
                ...icpDependencies
            };

            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
            this.logger(`✅ Updated package.json with ICP dependencies`);
            return true;

        } catch (error) {
            this.logger(`❌ Failed to update package.json: ${error}`, 'error');
            return false;
        }
    }

    async createFullFrontend(session: BuildSession, token: vscode.CancellationToken): Promise<boolean> {
        try {
            if (!session.projectPath) {
                session.error = 'Project path not available for frontend creation';
                return false;
            }

            session.status = 'building-frontend';
            const generatedFiles = await this.buildFrontendCode(session, token);
            if (!generatedFiles) {
                session.error = 'Failed to generate frontend code';
                return false;
            }

            const replaceSuccess = await this.replaceFrontendCode(session.projectPath, generatedFiles, session.config);
            if (!replaceSuccess) {
                session.error = 'Failed to replace frontend code';
                return false;
            }

            const packageSuccess = await this.updatePackageJson(session.projectPath, session.config);
            if (!packageSuccess) {
                this.logger(`⚠️ package.json update had issues, but continuing...`, 'warn');
            }

            this.logger(`🎉 Frontend creation completed successfully!`);
            return true;

        } catch (error) {
            session.error = `Frontend creation failed: ${error}`;
            this.logger(`❌ Frontend creation failed: ${error}`, 'error');
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
            this.logger(`⚠️ Error cleaning generated frontend code: ${error}`, 'warn');
            return rawCode;
        }
    }

    private removeMarkdownCodeBlocks(code: string): string {
        const codeBlockRegex = /```(?:jsx|tsx|javascript|typescript|react|nextjs)?\n?([\s\S]*?)```/g;
        const matches = code.match(codeBlockRegex);

        if (matches && matches.length > 0) {
            const match = matches[0];
            const content = match.replace(/```(?:jsx|tsx|javascript|typescript|react|nextjs)?\n?/, '').replace(/```$/, '');
            return content;
        }

        return code;
    }

    private extractMarkdownSections(content: string): Map<string, string> {
        const files = new Map<string, string>();

        const codeBlocks = content.match(/```(?:jsx|tsx|javascript|typescript|css|scss|json)\n([\s\S]*?)```/g);

        if (codeBlocks) {
            for (const block of codeBlocks) {
                if (block.includes('```jsx') || block.includes('```tsx')) {
                    const code = block.replace(/```(?:jsx|tsx)\n?/, '').replace(/```$/, '').trim();
                    const filename = block.includes('```tsx') ? 'App.tsx' : 'App.jsx';
                    files.set(filename, code);
                } else if (block.includes('```css') || block.includes('```scss')) {
                    const code = block.replace(/```(?:css|scss)\n?/, '').replace(/```$/, '').trim();
                    const filename = block.includes('```scss') ? 'index.scss' : 'globals.css';
                    files.set(filename, code);
                } else if (block.includes('```json')) {
                    const code = block.replace(/```json\n?/, '').replace(/```$/, '').trim();
                    files.set('package.json', code);
                }
            }
        }

        if (files.size === 0) {
            files.set('main', content);
        }

        return files;
    }

    generatePackageJson(config: IcdAppConfig, projectName: string): string {
        const basePackage: any = {
            name: `${projectName.toLowerCase()}-frontend`,
            version: "0.1.0",
            private: true,
            scripts: {},
            dependencies: {
                "@dfinity/agent": "^0.20.0",
                "@dfinity/candid": "^0.20.0",
                "@dfinity/principal": "^0.20.0",
                "@dfinity/auth-client": "^0.20.0",
                "react": "^18.2.0",
                "react-dom": "^18.2.0"
            },
            devDependencies: {
                "@types/react": "^18.2.0",
                "@types/react-dom": "^18.2.0",
                "typescript": "^5.0.0"
            }
        };

        if (config.frontend === 'nextjs') {
            basePackage.scripts = {
                "dev": "next dev",
                "build": "next build",
                "start": "next start",
                "lint": "next lint"
            };
            basePackage.dependencies = {
                ...basePackage.dependencies,
                "next": "^14.0.0"
            };
            basePackage.devDependencies = {
                ...basePackage.devDependencies,
                "@types/node": "^20.0.0",
                "eslint": "^8.0.0",
                "eslint-config-next": "^14.0.0"
            };
        } else {
            basePackage.scripts = {
                "dev": "vite",
                "build": "tsc && vite build",
                "preview": "vite preview"
            };
            basePackage.devDependencies = {
                ...basePackage.devDependencies,
                "@vitejs/plugin-react": "^4.0.0",
                "vite": "^4.0.0"
            };
        }

        return JSON.stringify(basePackage, null, 2);
    }

    generateFrontendInstructions(config: IcdAppConfig): string {
        const instructions = {
            reactjs: `### Frontend Web3 Interface (React.js)
\`\`\`bash
cd src/frontend
# Install dependencies
npm install
# Start development server
npm run dev
# Build for production
npm run build
\`\`\``,
            nextjs: `### Frontend Web3 Interface (Next.js)
\`\`\`bash
cd src/frontend
# Install dependencies
npm install
# Start development server
npm run dev
# Build for production
npm run build
# Start production server
npm start
\`\`\``
        };

        return instructions[config.frontend.toLowerCase() as keyof typeof instructions] || instructions.reactjs;
    }

    validateFrontendConfig(config: IcdAppConfig): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!config.frontend || !['react', 'nextjs'].includes(config.frontend.toLowerCase())) {
            errors.push('Invalid frontend framework. Must be react or nextjs.');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    validateFrontendStructure(projectPath: string, config: IcdAppConfig): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        try {
            const projectName = path.basename(projectPath);
            const frontendPath = path.join(projectPath, 'src', `${projectName}_frontend`);

            if (!fs.existsSync(frontendPath)) {
                errors.push(`Frontend directory not found: ${frontendPath}`);
                return { valid: false, errors };
            }

            const packageJsonPath = path.join(frontendPath, 'package.json');
            if (!fs.existsSync(packageJsonPath)) {
                errors.push('package.json not found in frontend directory');
            }

            const frontendPaths = this.getFrontendFilePaths(projectPath, config.frontend);
            if (!fs.existsSync(frontendPaths.appFile)) {
                errors.push(`Main app file not found: ${frontendPaths.appFile}`);
            }

            if (!fs.existsSync(frontendPaths.stylesFile)) {
                errors.push(`Styles file not found: ${frontendPaths.stylesFile}`);
            }

        } catch (error) {
            errors.push(`Frontend validation error: ${error}`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}