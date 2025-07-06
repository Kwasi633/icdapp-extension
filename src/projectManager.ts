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

    private async createEnhancedDocumentation(session: BuildSession): Promise<void> {
        if (!session.projectPath) return;

        const readme = this.buildEnhancedReadme(session);
        fs.writeFileSync(path.join(session.projectPath, 'README.md'), readme);

        const devGuide = this.generateDevelopmentGuide(session);
        fs.writeFileSync(path.join(session.projectPath, 'DEVELOPMENT.md'), devGuide);

        const deployInstructions = this.backendBuilder.generateDeploymentInstructions(session.projectPath, session.config);
        fs.writeFileSync(path.join(session.projectPath, 'DEPLOYMENT.md'), deployInstructions);
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

    private buildEnhancedReadme(session: BuildSession): string {
        const projectName = session.config.projectName;
        
        return `# ${projectName} - ICP Fullstack Web3 dApp

${session.config.description}

Built with IcdApp Extension - AI-Powered Web3 Development Platform

## 🚀 Quick Start

\`\`\`bash
# Install dependencies
cd src/${projectName}_frontend
npm install

# Start local ICP replica
dfx start --background

# Deploy backend canister
dfx deploy

# Start frontend development server
npm run dev
\`\`\`

## 📋 Configuration

- **Frontend**: ${session.config.frontend} (Web3 Interface)
- **Backend**: ${session.config.backend} (ICP Canister)
- **Project**: ${projectName}

## 🏗️ Project Architecture

This is a standard ICP project created with \`dfx new\` and enhanced with AI-generated code:

- **Backend Canister**: Provides decentralized smart contract functionality on ICP
- **Frontend Application**: Modern ${session.config.frontend} interface with ICP integration
- **Candid Interface**: Type-safe communication between frontend and backend

## 📂 Project Structure

\`\`\`
${projectName}/
├── dfx.json                           # ICP project configuration
├── src/
│   ├── ${projectName}_backend/        # Backend canister
│   │   ├── ${session.config.backend === 'motoko' ? 'main.mo' : 'lib.rs'}                      # Main canister logic
${session.config.backend === 'rust' ? `│   │   ├── Cargo.toml                 # Rust dependencies` : ''}
│   │   └── ${projectName}_backend.did # Candid interface
│   └── ${projectName}_frontend/       # Frontend application
│       ├── src/
│       │   ├── App.tsx                # Main React component
│       │   └── utils/
│       │       └── icpAgent.ts        # ICP Web3 integration
│       ├── package.json               # Frontend dependencies
│       └── ${session.config.frontend === 'nextjs' ? 'next.config.js' : 'vite.config.ts'}             # Build configuration
├── deploy.sh                          # Deployment script
├── dev.sh                             # Development startup script
├── DEVELOPMENT.md                     # Development guide
├── DEPLOYMENT.md                      # Deployment instructions
└── README.md                          # This file
\`\`\`

## 🛠️ Development Commands

\`\`\`bash
# Start everything for development
./dev.sh

# Deploy backend only
dfx deploy

# Deploy frontend only
cd src/${projectName}_frontend && npm run build

# Deploy everything
./deploy.sh

# Check canister status
dfx canister status ${projectName}_backend

# Call canister methods
dfx canister call ${projectName}_backend [method_name]
\`\`\`

## 🌐 Deployment

### Local Development
1. Start local replica: \`dfx start --background\`
2. Deploy canister: \`dfx deploy\`
3. Start frontend: \`cd src/${projectName}_frontend && npm run dev\`

### Production Deployment
1. Deploy to IC mainnet: \`dfx deploy --network ic\`
2. Build frontend: \`cd src/${projectName}_frontend && npm run build\`

## 🔗 Useful Links

- [Internet Computer Documentation](https://internetcomputer.org/docs)
- [DFX SDK Documentation](https://internetcomputer.org/docs/current/developer-docs/setup/install)
- [Candid Interface Guide](https://internetcomputer.org/docs/current/developer-docs/backend/candid)

---

**Build Information:**
- Generated: ${new Date().toISOString()}
- Build Session ID: ${session.id}
- Created with: dfx new + IcdApp AI Enhancement

For support and documentation, visit the IcdApp extension marketplace page.
`;
    }

    private generateDevelopmentGuide(session: BuildSession): string {
        const projectName = session.config.projectName;
        
        return `# Development Guide - ${projectName}

## Prerequisites

- Node.js (v18 or later)
- DFX SDK (latest version)
${session.config.backend === 'rust' ? '- Rust toolchain with wasm32-unknown-unknown target' : ''}

## Project Setup

This project was created using \`dfx new\` and enhanced with AI-generated code.

### 1. Install Dependencies

\`\`\`bash
# Install frontend dependencies
cd src/${projectName}_frontend
npm install
\`\`\`

### 2. Start Development Environment

\`\`\`bash
# Start local ICP replica
dfx start --background

# Deploy backend canister
dfx deploy

# Start frontend development server
cd src/${projectName}_frontend
npm run dev
\`\`\`

## Backend Development (${session.config.backend})

The backend canister is located in \`src/${projectName}_backend/\`.

### Key Files:
- \`${session.config.backend === 'motoko' ? 'main.mo' : 'lib.rs'}\` - Main canister logic
- \`${projectName}_backend.did\` - Candid interface definition
${session.config.backend === 'rust' ? '- `Cargo.toml` - Rust dependencies' : ''}

### Development Commands:
\`\`\`bash
# Deploy backend changes
dfx deploy ${projectName}_backend

# Generate Candid interface
dfx generate ${projectName}_backend

# Call backend methods
dfx canister call ${projectName}_backend [method_name]
\`\`\`

## Frontend Development (${session.config.frontend})

The frontend application is located in \`src/${projectName}_frontend/\`.

### Key Files:
- \`src/App.tsx\` - Main React component with ICP integration
- \`src/utils/icpAgent.ts\` - ICP agent configuration
- \`package.json\` - Dependencies and scripts

### Development Commands:
\`\`\`bash
cd src/${projectName}_frontend

# Start development server
npm run dev

# Build for production
npm run build

# Run tests (if configured)
npm test
\`\`\`

## Integration Between Frontend and Backend

The frontend communicates with the backend canister using:

1. **@dfinity/agent** - For creating the ICP agent
2. **Generated declarations** - Type-safe canister interfaces
3. **Candid** - For serialization/deserialization

### Example Integration:
\`\`\`typescript
// In src/utils/icpAgent.ts
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from '../declarations/${projectName}_backend';

const agent = new HttpAgent();
const actor = Actor.createActor(idlFactory, {
  agent,
  canisterId: process.env.CANISTER_ID_${projectName.toUpperCase()}_BACKEND,
});
\`\`\`

## Deployment Workflow

### Local Testing:
1. \`dfx start --background\`
2. \`dfx deploy\`
3. Test functionality

### Production Deployment:
1. \`dfx deploy --network ic\`
2. Update frontend with production canister IDs
3. Build and deploy frontend to hosting service

## Troubleshooting

### Common Issues:

1. **Canister not found**: Ensure \`dfx deploy\` completed successfully
2. **Frontend connection issues**: Check canister IDs in environment variables
3. **Build errors**: Ensure all dependencies are installed

### Debug Commands:
\`\`\`bash
# Check canister status
dfx canister status ${projectName}_backend

# View canister logs
dfx canister logs ${projectName}_backend

# Reset local replica
dfx stop && dfx start --clean
\`\`\`

## Adding New Features

1. **Backend**: Add methods to \`${session.config.backend === 'motoko' ? 'main.mo' : 'lib.rs'}\`
2. **Frontend**: Update \`App.tsx\` and create new components
3. **Integration**: Update agent configuration if needed
4. **Testing**: Test locally before deployment

---

Generated by IcdApp Extension - AI-Powered Web3 Development
`;
    }
    private generateEnhancedDeployScript(config: IcdAppConfig): string {
        const isNextJS = config.frontend === 'nextjs';
        
        return `#!/bin/bash

echo "🚀 Deploying ICP Fullstack dApp..."

# Exit on any error
set -e

# Check if dfx is installed
if ! command -v dfx &> /dev/null; then
    echo "❌ DFX is not installed. Please install DFX SDK first."
    exit 1
fi

# Check if we're in a dfx project
if [ ! -f "dfx.json" ]; then
    echo "❌ Not in a DFX project directory"
    exit 1
fi

# Start local replica if not running
echo "🔄 Checking local replica status..."
if ! dfx ping local &> /dev/null; then
    echo "🚀 Starting local replica..."
    dfx start --background
fi

# Deploy backend canister
echo "📦 Deploying backend canister..."
dfx deploy

# Install frontend dependencies if needed
if [ ! -d "src/*/node_modules" ]; then
    echo "📋 Installing frontend dependencies..."
    cd src/*_frontend
    npm install
    cd ../..
fi

# Build frontend
echo "🎨 Building frontend..."
cd src/*_frontend
npm run build
cd ../..

# Get canister URLs
echo "✅ Deployment complete!"
echo ""
echo "🔗 Backend canister deployed successfully"
echo "📊 Candid UI: \$(dfx canister call --query ic://\$(dfx canister id *_backend)/)"
echo "🌐 Frontend: http://localhost:${isNextJS ? '3000' : '5173'}"
echo ""
echo "🚀 Your dApp is ready for development!"
`;
    }
}