import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BuildSession, IcdAppConfig, GeneratedFiles } from './backendBuilder';
import { BackendBuilder } from './backendBuilder';
import { FrontendBuilder, GeneratedFrontendFiles } from './frontendBuilder';

export class ProjectManager {
    private backendBuilder: BackendBuilder;
    private frontendBuilder: FrontendBuilder;
    private logger: (message: string, level?: 'info' | 'warn' | 'error') => void;

    constructor(
        backendBuilder: BackendBuilder, 
        frontendBuilder: FrontendBuilder, 
        logger: (message: string, level?: 'info' | 'warn' | 'error') => void
    ) {
        this.backendBuilder = backendBuilder;
        this.frontendBuilder = frontendBuilder;
        this.logger = logger;
    }

    async createProjectFiles(session: BuildSession, token: vscode.CancellationToken): Promise<void> {
        try {
            this.logger(`📁 Creating project files for session: ${session.id}`);

            const folderUri = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Select dApp Project Folder'
            });

            if (!folderUri || !folderUri[0]) {
                this.logger('❌ No folder selected for dApp project creation', 'warn');
                return;
            }

            const workspacePath = folderUri[0].fsPath;

            const success = await this.createFullstackProject(session, workspacePath, token);
            
            if (!success) {
                this.logger(`❌ Failed to create fullstack dApp project`, 'error');
                return;
            }

            this.logger(`✅ Fullstack dApp project created at: ${session.projectPath}`);

            if (session.projectPath) {
                await this.promptProjectOpen(session.projectPath);
            }

        } catch (error) {
            this.logger(`❌ Error creating dApp project files: ${error}`, 'error');
            throw error;
        }
    }

    private async createFullstackProject(session: BuildSession, workspacePath: string, token: vscode.CancellationToken): Promise<boolean> {
        try {
            session.status = 'creating-project';
            const backendSuccess = await this.backendBuilder.createFullBackend(session, workspacePath, token);
            
            if (!backendSuccess || !session.projectPath) {
                return false;
            }

            session.status = 'building-frontend';
            const frontendSuccess = await this.enhanceFrontend(session, token);
            
            if (!frontendSuccess) {
                this.logger(`⚠️ Frontend enhancement failed, but project structure exists`, 'warn');
            }

            const validation = this.validateFullstackProject(session.projectPath, session.config);
            if (!validation.valid) {
                this.logger(`⚠️ Project validation issues: ${validation.errors.join(', ')}`, 'warn');
            }

            session.status = 'completed';
            return true;

        } catch (error) {
            session.status = 'error';
            session.error = `Fullstack project creation failed: ${error}`;
            this.logger(`❌ Fullstack project creation failed: ${error}`, 'error');
            return false;
        }
    }

    private async enhanceFrontend(session: BuildSession, token: vscode.CancellationToken): Promise<boolean> {
        try {
            if (!session.projectPath) {
                return false;
            }

            const frontendFiles = await this.frontendBuilder.buildFrontendCode(session, token);
            
            if (frontendFiles) {
                const projectName = path.basename(session.projectPath);
                const frontendPath = path.join(session.projectPath, 'src', `${projectName}_frontend`);
                
                await this.replaceFrontendFiles(frontendPath, frontendFiles, session.config);
                
                // Store the main app file content for reference
                session.frontendCode = frontendFiles.appFile.content;
                this.logger(`✅ Frontend enhanced with AI-generated code`);
                return true;
            }

            return false;
        } catch (error) {
            this.logger(`❌ Frontend enhancement failed: ${error}`, 'error');
            return false;
        }
    }

    private async replaceFrontendFiles(frontendPath: string, frontendFiles: GeneratedFrontendFiles, config: IcdAppConfig): Promise<void> {
        try {
            const srcPath = path.join(frontendPath, 'src');
            const mainComponentPath = path.join(srcPath, frontendFiles.appFile.filename);

            if (fs.existsSync(mainComponentPath)) {
                const backupPath = `${mainComponentPath}.backup.${Date.now()}`;
                fs.copyFileSync(mainComponentPath, backupPath);
                this.logger(`📄 Created backup: ${path.basename(backupPath)}`);
            }

            if (!fs.existsSync(srcPath)) {
                fs.mkdirSync(srcPath, { recursive: true });
            }

            fs.writeFileSync(mainComponentPath, frontendFiles.appFile.content, 'utf8');

            if (frontendFiles.stylesFile) {
                const stylesPath = path.join(srcPath, frontendFiles.stylesFile.filename);
                fs.writeFileSync(stylesPath, frontendFiles.stylesFile.content, 'utf8');
                this.logger(`📄 Created styles file: ${frontendFiles.stylesFile.filename}`);
            }

            if (frontendFiles.additionalFiles) {
                for (const file of frontendFiles.additionalFiles) {
                    const filePath = path.join(srcPath, file.filename);
                    const fileDir = path.dirname(filePath);
                    if (!fs.existsSync(fileDir)) {
                        fs.mkdirSync(fileDir, { recursive: true });
                    }
                    fs.writeFileSync(filePath, file.content, 'utf8');
                    this.logger(`📄 Created additional file: ${file.filename}`);
                }
            }

            await this.createFrontendUtilities(frontendPath, config);

            this.logger(`✅ Frontend files updated successfully`);
        } catch (error) {
            throw new Error(`Failed to replace frontend files: ${error}`);
        }
    }

    private async createFrontendUtilities(frontendPath: string, config: IcdAppConfig): Promise<void> {
        const utilsPath = path.join(frontendPath, 'src', 'utils');
        
        if (!fs.existsSync(utilsPath)) {
            fs.mkdirSync(utilsPath, { recursive: true });
        }

        const icpAgentCode = this.generateWeb3AgentCode();
        fs.writeFileSync(path.join(utilsPath, 'icpAgent.ts'), icpAgentCode);

        await this.updateFrontendPackageJson(frontendPath, config);

        await this.createFrontendConfigFiles(frontendPath, config);
    }

    private generateWeb3AgentCode(): string {
        return `import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';

// Initialize the agent
const agent = new HttpAgent({
  host: process.env.NODE_ENV === 'production' 
    ? 'https://ic0.app' 
    : 'http://localhost:8000'
});

// Fetch root key for development
if (process.env.NODE_ENV !== 'production') {
  agent.fetchRootKey().catch(err => {
    console.warn('Unable to fetch root key. Check if local replica is running.');
    console.error(err);
  });
}

export { agent };

// Helper function to create actor
export const createActor = (canisterId: string, idlFactory: any) => {
  return Actor.createActor(idlFactory, {
    agent,
    canisterId,
  });
};

// Helper function to get canister ID from environment
export const getCanisterId = (canisterName: string): string => {
  const envKey = \`CANISTER_ID_\${canisterName.toUpperCase()}\`;
  return process.env[envKey] || '';
};
`;
    }

    private async updateFrontendPackageJson(frontendPath: string, config: IcdAppConfig): Promise<void> {
        const packageJsonPath = path.join(frontendPath, 'package.json');
        
        if (fs.existsSync(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                
                const additionalDeps = {
                    "@dfinity/agent": "^1.0.1",
                    "@dfinity/auth-client": "^1.0.1",
                    "@dfinity/candid": "^1.0.1",
                    "@dfinity/principal": "^1.0.1"
                };

                packageJson.dependencies = { ...packageJson.dependencies, ...additionalDeps };

                packageJson.scripts = {
                    ...packageJson.scripts,
                    "dev": config.frontend === 'nextjs' ? "next dev" : "vite",
                    "build": config.frontend === 'nextjs' ? "next build" : "vite build",
                    "preview": config.frontend === 'nextjs' ? "next start" : "vite preview"
                };

                fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
                this.logger(`✅ Updated package.json with Web3 dependencies`);
            } catch (error) {
                this.logger(`⚠️ Failed to update package.json: ${error}`, 'warn');
            }
        }
    }

    private async createFrontendConfigFiles(frontendPath: string, config: IcdAppConfig): Promise<void> {
        const tsConfigPath = path.join(frontendPath, 'tsconfig.json');
        if (!fs.existsSync(tsConfigPath)) {
            const tsConfig = this.generateTsConfigCode(config);
            fs.writeFileSync(tsConfigPath, tsConfig);
        }

        if (config.frontend === 'nextjs') {
            const nextConfigPath = path.join(frontendPath, 'next.config.js');
            if (!fs.existsSync(nextConfigPath)) {
                const nextConfig = this.generateNextConfigCode();
                fs.writeFileSync(nextConfigPath, nextConfig);
            }
        } else {
            const viteConfigPath = path.join(frontendPath, 'vite.config.ts');
            if (!fs.existsSync(viteConfigPath)) {
                const viteConfig = this.generateViteConfigCode();
                fs.writeFileSync(viteConfigPath, viteConfig);
            }
        }
    }

    private generateTsConfigCode(config: IcdAppConfig): string {
        const tsConfig = {
            compilerOptions: {
                target: "ES2020",
                lib: ["ES2020", "DOM", "DOM.Iterable"],
                allowJs: true,
                skipLibCheck: true,
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                strict: true,
                forceConsistentCasingInFileNames: true,
                moduleResolution: "node",
                resolveJsonModule: true,
                isolatedModules: true,
                noEmit: config.frontend === 'nextjs',
                jsx: config.frontend === 'nextjs' ? "preserve" : "react-jsx",
                ...(config.frontend === 'nextjs' && {
                    plugins: [{ name: "next" }],
                    incremental: true
                })
            },
            include: ["src", "next-env.d.ts"],
            exclude: ["node_modules"]
        };

        return JSON.stringify(tsConfig, null, 2);
    }

    private generateNextConfigCode(): string {
        return `/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
  env: {
    CANISTER_ID_BACKEND: process.env.CANISTER_ID_BACKEND,
  },
};

module.exports = nextConfig;
`;
    }

    private generateViteConfigCode(): string {
        return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  define: {
    'process.env': process.env,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
`;
    }

    private validateFullstackProject(projectPath: string, config: IcdAppConfig): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        try {
            const backendValidation = this.backendBuilder.validateProjectStructure(projectPath, config);
            errors.push(...backendValidation.errors);

            const projectName = path.basename(projectPath);
            const frontendPath = path.join(projectPath, 'src', `${projectName}_frontend`);
            
            if (!fs.existsSync(frontendPath)) {
                errors.push(`Frontend directory not found: ${frontendPath}`);
            } else {
                const srcPath = path.join(frontendPath, 'src');
                const packageJsonPath = path.join(frontendPath, 'package.json');
                
                if (!fs.existsSync(srcPath)) {
                    errors.push(`Frontend src directory not found: ${srcPath}`);
                }
                if (!fs.existsSync(packageJsonPath)) {
                    errors.push(`Frontend package.json not found: ${packageJsonPath}`);
                }
            }

        } catch (error) {
            errors.push(`Validation error: ${error}`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    private async promptProjectOpen(projectPath: string): Promise<void> {
        const openProject = await vscode.window.showInformationMessage(
            'Fullstack dApp project created successfully! Would you like to open it in a new VS Code window?',
            'Open Project',
            'Open in Current Window',
            'Cancel'
        );

        switch (openProject) {
            case 'Open Project':
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), true);
                break;
            case 'Open in Current Window':
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath), false);
                break;
            default:
                this.logger(`📁 Project available at: ${projectPath}`);
                break;
        }
    }
}