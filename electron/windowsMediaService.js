import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import EventEmitter from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WindowsMediaService extends EventEmitter {
    constructor() {
        super();
        this.process = null;
        this.buffer = '';
        this.isRunning = false;
        this.restartAttempts = 0;
        this.maxRestartAttempts = 5;
        this.restartTimer = null;
    }

    start(options = {}) {
        if (process.platform !== 'win32') {
            console.log('[WindowsMediaService] Not running on Windows, SMTC listener disabled.');
            return;
        }

        if (this.isRunning && this.process) {
            return;
        }

        let scriptPath = path.join(__dirname, 'smtc-listener.ps1');
        if (scriptPath.includes('app.asar')) {
            scriptPath = scriptPath.replace('app.asar', 'app.asar.unpacked');
        }

        const args = [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath
        ];

        if (options.includeAllApps) {
            args.push('-IncludeAllApps');
        }

        console.log('[WindowsMediaService] Spawning native SMTC listener...');
        try {
            this.process = spawn('powershell.exe', args, {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            this.isRunning = true;

            this.process.stdout.on('data', (data) => {
                this.handleStdout(data.toString('utf8'));
            });

            this.process.stderr.on('data', (data) => {
                const errStr = data.toString('utf8').trim();
                if (errStr && !errStr.includes('DEBUG')) {
                    console.warn('[WindowsMediaService] stderr:', errStr);
                }
            });

            this.process.on('exit', (code, signal) => {
                console.log(`[WindowsMediaService] Process exited with code ${code}, signal: ${signal}`);
                this.isRunning = false;
                this.process = null;

                // Automatic recovery if not intentionally stopped
                if (code !== 0 && this.restartAttempts < this.maxRestartAttempts) {
                    this.restartAttempts++;
                    const delay = Math.min(3000 * this.restartAttempts, 15000);
                    console.log(`[WindowsMediaService] Restarting in ${delay}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})...`);
                    this.restartTimer = setTimeout(() => {
                        this.start(options);
                    }, delay);
                }
            });

            this.process.on('error', (err) => {
                console.error('[WindowsMediaService] Process error:', err);
                this.emit('error', err);
            });
        } catch (err) {
            console.error('[WindowsMediaService] Failed to spawn powershell:', err);
        }
    }

    handleStdout(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('{')) continue;

            try {
                const event = JSON.parse(trimmed);
                if (event.type === 'ready') {
                    console.log('[WindowsMediaService] GSMTC Monitor Ready:', event.message);
                    this.restartAttempts = 0; // Reset restart counter on successful startup
                    this.emit('ready');
                } else if (event.type === 'song_update') {
                    this.emit('song_update', event);
                } else if (event.type === 'progress_update') {
                    this.emit('progress_update', event);
                } else if (event.type === 'error') {
                    console.warn('[WindowsMediaService] Monitor reported error:', event.message);
                }
            } catch {
                // Ignore non-json or corrupted line fragments
            }
        }
    }

    sendCommand(action, payload = {}) {
        if (!this.isRunning || !this.process) {
            this.start();
        }

        if (!this.process || !this.process.stdin || !this.process.stdin.writable) {
            console.warn('[WindowsMediaService] Cannot send command: stdin is not writable');
            return false;
        }

        try {
            const cmd = JSON.stringify({ action, ...payload }) + '\n';
            this.process.stdin.write(cmd, 'utf8');
            return true;
        } catch (err) {
            console.warn('[WindowsMediaService] Failed to send command to listener:', err);
            return false;
        }
    }

    stop() {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }

        if (this.process) {
            this.isRunning = false;
            try {
                this.process.stdin.end(); // triggers clean exit via EOF
                setTimeout(() => {
                    if (this.process) {
                        this.process.kill();
                        this.process = null;
                    }
                }, 1000);
            } catch {
                if (this.process) this.process.kill();
                this.process = null;
            }
        }
    }
}

export const windowsMediaService = new WindowsMediaService();
