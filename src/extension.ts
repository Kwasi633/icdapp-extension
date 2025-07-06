import * as vscode from 'vscode';
import axios from 'axios';
import { BackendBuilder, BuildSession, IcdAppConfig } from './backendBuilder';
import { FrontendBuilder } from './frontendBuilder';
import { ProjectManager } from './projectManager';

class IcdAppExtension {
    private outputChannel: vscode.OutputChannel;
    private statusBar: vscode.StatusBarItem;
    private activeSessions: Map<string, BuildSession> = new Map();
    private apiBaseUrl: string;

    private backendBuilder: BackendBuilder;
    private frontendBuilder: FrontendBuilder;
    private projectManager: ProjectManager;

    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('IcdApp');
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.apiBaseUrl = vscode.workspace.getConfiguration('icdapp').get('apiUrl', 'https://icdapp-server.onrender.com');

        this.backendBuilder = new BackendBuilder(this.apiBaseUrl, this.log.bind(this));
        this.frontendBuilder = new FrontendBuilder(this.apiBaseUrl, this.log.bind(this));
        this.projectManager = new ProjectManager(
            this.backendBuilder, 
            this.frontendBuilder, 
            this.log.bind(this)
        );

        this.log('🚀 IcdApp Extension initialized - Fullstack Web3 ICP dApp Development');
        this.setupStatusBar();
    }

    private log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage);
        this.outputChannel.appendLine(logMessage);

        if (level === 'error') {
            vscode.window.showErrorMessage(message);
        } else if (level === 'warn') {
            vscode.window.showWarningMessage(message);
        }
    }

    private setupStatusBar() {
        this.statusBar.text = "$(rocket) IcdApp Ready";
        this.statusBar.tooltip = "IcdApp - AI-Powered Fullstack ICP dApp";
        this.statusBar.command = 'icdapp.buildDApp';
        this.statusBar.show();
    }

    public activate() {
        this.log('🔥 Activating IcdApp Extension - Fullstack Web3 dApp Development Platform...');

        const commands = [
            {
                command: 'icdapp.buildDApp',
                handler: this.buildDApp.bind(this),
                title: 'Build Fullstack ICP dApp'
            },
            {
                command: 'icdapp.showSessions',
                handler: this.showActiveSessions.bind(this),
                title: 'Show Active Build Sessions'
            },
            {
                command: 'icdapp.validateProject',
                handler: this.validateProject.bind(this),
                title: 'Validate ICP dApp Project'
            },
            {
                command: 'icdapp.openOutput',
                handler: () => this.outputChannel.show(),
                title: 'Open IcdApp Output'
            }
        ];

        commands.forEach(({ command, handler, title }) => {
            try {
                const disposable = vscode.commands.registerCommand(command, handler);
                this.context.subscriptions.push(disposable);
                this.log(`✅ Registered command: ${command}`);
            } catch (error) {
                this.log(`❌ Failed to register command ${command}: ${error}`, 'error');
            }
        });

        this.validateApiConnection();

        this.log(`✅ Extension activated with ${this.context.subscriptions.length} subscriptions`);
        return {
            activated: true,
            version: '1.0.0',
            apiUrl: this.apiBaseUrl
        };
    }

    private async validateApiConnection(): Promise<boolean> {
        try {
            this.log('🔍 Validating Web3 dApp API connection...');
            const response = await axios.get(`${this.apiBaseUrl}/health`, { timeout: 5000 });

            if (response.status === 200) {
                this.log('✅ API connection validated - Ready for dApp development');
                return true;
            } else {
                this.log(`⚠️ API returned status: ${response.status}`, 'warn');
                return false;
            }
        } catch (error) {
            this.log(`❌ API connection failed: ${error}`, 'warn');
            vscode.window.showWarningMessage(
                'IcdApp API is not reachable. Please ensure the fullstack dApp builder server is running.',
                'Check Settings'
            ).then(selection => {
                if (selection === 'Check Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'icdapp');
                }
            });
            return false;
        }
    }

    private async buildDApp() {
        try {
            this.log('🎯 Starting fullstack Web3 dApp builder wizard...');

            const config = await this.getUserConfiguration();
            if (!config) {
                this.log('❌ User cancelled dApp configuration', 'warn');
                return;
            }

            
            const workspacePath = await this.getWorkspacePath();
            if (!workspacePath) {
                this.log('❌ No workspace folder available', 'error');
                return;
            }

            const session = this.createBuildSession(config);
            this.log(`📝 Created build session: ${session.id} for ${config.description}`);

            await this.executeBuildPipeline(session, workspacePath);

        } catch (error) {
            this.log(`❌ dApp build failed: ${error}`, 'error');
        }
    }

    private async getWorkspacePath(): Promise<string | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            const selection = await vscode.window.showWarningMessage(
                'No workspace folder is open. Please open a folder to create your ICP dApp.',
                'Open Folder'
            );
            
            if (selection === 'Open Folder') {
                await vscode.commands.executeCommand('vscode.openFolder');
            }
            return null;
        }

        return workspaceFolders[0].uri.fsPath;
    }

    private async validateProject() {
        try {
            this.log('🔍 Validating current ICP dApp project...');

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            const projectPath = workspaceFolders[0].uri.fsPath;
            
            const dfxFiles = await vscode.workspace.findFiles('dfx.json', null, 1);
            if (dfxFiles.length === 0) {
                vscode.window.showWarningMessage('No dfx.json found - this doesn\'t appear to be an ICP project');
                return;
            }

            const motokoFiles = await vscode.workspace.findFiles('src/**/*.mo', null, 1);
            const rustFiles = await vscode.workspace.findFiles('src/**/lib.rs', null, 1);
            
            let backendType: 'motoko' | 'rust' | null = null;
            if (motokoFiles.length > 0) backendType = 'motoko';
            else if (rustFiles.length > 0) backendType = 'rust';

            if (backendType) {
                const mockConfig: IcdAppConfig = {
                    backend: backendType,
                    frontend: 'react',
                    description: 'Existing project',
                    projectName: 'current_project'
                };

                const validation = this.backendBuilder.validateProjectStructure(projectPath, mockConfig);
                
                const report = validation.valid 
                    ? '✅ Project structure is valid'
                    : `❌ Project validation failed:\n${validation.errors.join('\n')}`;

                vscode.window.showInformationMessage(report, { modal: true });
            } else {
                vscode.window.showWarningMessage('Could not determine backend type (Motoko or Rust)');
            }

        } catch (error) {
            this.log(`❌ Project validation failed: ${error}`, 'error');
        }
    }

    private async getUserConfiguration(): Promise<IcdAppConfig | null> {
        try {
            const projectName = await vscode.window.showInputBox({
                title: 'Enter Project Name',
                placeHolder: 'my_icp_dapp',
                prompt: 'Enter a name for your ICP dApp project',
                validateInput: (value) => {
                    if (!value || value.trim().length < 3) {
                        return 'Project name must be at least 3 characters';
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
                        return 'Project name can only contain letters, numbers, underscores, and hyphens';
                    }
                    return null;
                }
            });

            if (!projectName) return null;

            const frontendOptions: vscode.QuickPickItem[] = [
                { label: 'react', description: 'React.js with TypeScript' },
                { label: 'nextjs', description: 'Next.js with TypeScript' }
            ];

            const frontendChoice = await vscode.window.showQuickPick(frontendOptions, {
                title: 'Select Frontend Framework for your Web3 dApp',
                placeHolder: 'Choose your preferred frontend framework'
            });

            if (!frontendChoice) return null;
            const frontend = frontendChoice.label as 'react' | 'nextjs';

            const backendOptions: vscode.QuickPickItem[] = [
                { label: 'motoko', description: 'Native ICP language' },
                { label: 'rust', description: 'High-performance systems language' }
            ];

            const backendChoice = await vscode.window.showQuickPick(backendOptions, {
                title: 'Select Backend Language for your ICP Canister',
                placeHolder: 'Choose your preferred backend language'
            });

            if (!backendChoice) return null;
            const backend = backendChoice.label as 'motoko' | 'rust';

            const description = await vscode.window.showInputBox({
                title: 'Describe Your ICP dApp',
                placeHolder: 'e.g build a decentralized crowdfunding platform',
                prompt: 'Enter a description of what you want to build',
                validateInput: (value) => {
                    if (!value || value.trim().length < 10) {
                        return 'Please provide a description with at least 10 characters';
                    }
                    return null;
                }
            });

            if (!description) return null;

            return {
                frontend,
                backend,
                description: description.trim(),
                projectName: projectName.trim()
            };

        } catch (error) {
            this.log(`❌ Error getting user configuration: ${error}`, 'error');
            return null;
        }
    }

    private createBuildSession(config: IcdAppConfig): BuildSession {
        const sessionId = `build_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const session: BuildSession = {
            id: sessionId,
            config,
            status: 'pending'
        };

        this.activeSessions.set(sessionId, session);
        return session;
    }

    private async executeBuildPipeline(session: BuildSession, workspacePath: string) {
        try {
            
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Building Fullstack ICP dApp',
                cancellable: true
            }, async (progress, token) => {
                
                progress.report({ increment: 30, message: 'Starting dApp build process...' });
                this.updateStatusBar('Building dApp...');

                const success = await this.backendBuilder.createFullBackend(session, workspacePath, token);
                
                if (!success) {
                    throw new Error(session.error || 'Backend creation failed');
                }

                progress.report({ increment: 60, message: 'Backend canister created successfully!' });

                session.status = 'building-frontend';
                progress.report({ increment: 70, message: 'Building frontend dApp...' });
                this.updateStatusBar(`Building ${session.config.frontend} dApp...`);

                if (this.frontendBuilder) {
                    try {
                        const frontendSuccess = await this.frontendBuilder.createFullFrontend(session, token);
                        if (frontendSuccess) {
                            progress.report({ increment: 90, message: 'Frontend dApp built successfully!' });
                            this.log('✅ Frontend created and integrated successfully');
                        } else {
                            this.log('⚠️ Frontend build failed, but backend was successful', 'warn');
                        }
                    } catch (frontendError) {
                        this.log(`⚠️ Frontend build error: ${frontendError}`, 'warn');
                    }
                }
                session.status = 'completed';
                progress.report({ increment: 100, message: 'dApp build completed!' });
                this.updateStatusBar('IcdApp Ready');

                
                if (session.projectPath) {
                    const instructions = this.backendBuilder.generateDeploymentInstructions(
                        session.projectPath, 
                        session.config
                    );
                    
                    const selection = await vscode.window.showInformationMessage(
                        `🎉 ICP dApp "${session.config.projectName}" created successfully!`,
                        'Open Project',
                        'View Instructions',
                        'Open in Terminal'
                    );

                    if (selection === 'Open Project') {
                        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(session.projectPath));
                    } else if (selection === 'View Instructions') {
                        this.showDeploymentInstructions(instructions);
                    } else if (selection === 'Open in Terminal') {
                        const terminal = vscode.window.createTerminal({
                            name: `ICP - ${session.config.projectName}`,
                            cwd: session.projectPath
                        });
                        terminal.show();
                    }
                }

                this.log(`✅ Successfully built fullstack dApp: ${session.config.projectName}`);
            });

        } catch (error) {
            session.status = 'error';
            session.error = error instanceof Error ? error.message : 'Unknown error';
            this.updateStatusBar('Build failed');
            this.log(`❌ Build pipeline failed: ${session.error}`, 'error');
            throw error;
        }
    }

    private async showDeploymentInstructions(instructions: string) {
        const doc = await vscode.workspace.openTextDocument({
            content: instructions,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
    }

    private updateStatusBar(text: string) {
        this.statusBar.text = `$(rocket) ${text}`;
    }

    private async showActiveSessions() {
        const sessions = Array.from(this.activeSessions.values());
        if (sessions.length === 0) {
            vscode.window.showInformationMessage('No active dApp build sessions');
            return;
        }

        const items = sessions.map(session => ({
            label: `${session.config.projectName}`,
            description: `${session.config.frontend} + ${session.config.backend}`,
            detail: `Status: ${session.status} | ${session.config.description}`,
            session: session
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Active Fullstack dApp Build Sessions'
        });

        if (selected) {
            const sessionInfo = `
            Project: ${selected.session.config.projectName}
            Session ID: ${selected.session.id}
            Status: ${selected.session.status}
            Frontend: ${selected.session.config.frontend}
            Backend: ${selected.session.config.backend}
            Description: ${selected.session.config.description}
            ${selected.session.projectPath ? `Path: ${selected.session.projectPath}` : ''}
            ${selected.session.error ? `Error: ${selected.session.error}` : ''}
            `.trim();

            const actions = ['View Output'];
            if (selected.session.projectPath) {
                actions.push('Open Project', 'Open Terminal');
            }

            const action = await vscode.window.showInformationMessage(
                sessionInfo, 
                { modal: true }, 
                ...actions
            );

            if (action === 'View Output') {
                this.outputChannel.show();
            } else if (action === 'Open Project' && selected.session.projectPath) {
                vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(selected.session.projectPath));
            } else if (action === 'Open Terminal' && selected.session.projectPath) {
                const terminal = vscode.window.createTerminal({
                    name: `ICP - ${selected.session.config.projectName}`,
                    cwd: selected.session.projectPath
                });
                terminal.show();
            }
        }
    }

    public deactivate() {
        this.log('🔥 Deactivating IcdApp Extension - Fullstack Web3 dApp Development Platform...');
        this.statusBar.dispose();
        this.outputChannel.dispose();
    }
}


export function activate(context: vscode.ExtensionContext) {
    const icdApp = new IcdAppExtension(context);
    return icdApp.activate();
}

export function deactivate() {
}