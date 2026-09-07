import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export class Sandbox {
  public cwd: string;
  public sandboxMode: boolean;

  // Dangerous commands deny-list according to Miss Data specification
  private static DANGEROUS_COMMAND_PATTERNS = [
    /\brm\s+-rf\s+[\/\\]/i,
    /\b(mkfs|dd\s+if=)/i,
    /:(){ :\|:& };:/,  // fork bomb
    /\b(shutdown|reboot|poweroff|init\s+0)\b/i,
    /\bsudo\b/i,
    /\|\s*(bash|sh|zsh)\b/i,
    /\bchmod\s+-R\s+777\s+[\/\\]/i,
    /\bchown\s+-R\b.*[\/\\]/i,
  ];

  constructor(initialCwd: string = process.cwd(), sandboxMode: boolean = true) {
    this.cwd = path.resolve(initialCwd);
    this.sandboxMode = sandboxMode;
  }

  public setCwd(newPath: string): { success: boolean; path: string; error?: string } {
    try {
      const resolved = path.resolve(this.cwd, newPath);
      if (this.sandboxMode && !resolved.startsWith(process.cwd())) {
        return { success: false, path: this.cwd, error: `Sandbox violation: path ${newPath} is outside workspace boundary.` };
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return { success: false, path: this.cwd, error: `Directory not found: ${newPath}` };
      }
      this.cwd = resolved;
      return { success: true, path: this.cwd };
    } catch (err: any) {
      return { success: false, path: this.cwd, error: err.message };
    }
  }

  public resolvePath(targetPath: string): { safe: boolean; fullPath: string; error?: string } {
    const fullPath = path.resolve(this.cwd, targetPath);
    if (this.sandboxMode) {
      const boundary = process.cwd();
      if (!fullPath.startsWith(boundary)) {
        return {
          safe: false,
          fullPath,
          error: `Sandbox violation: attempt to access '${targetPath}' outside sandbox root (${boundary})`,
        };
      }
    }
    return { safe: true, fullPath };
  }

  public readFile(filePath: string): { content: string; error?: string } {
    const check = this.resolvePath(filePath);
    if (!check.safe) return { content: '', error: check.error };
    try {
      if (!fs.existsSync(check.fullPath)) {
        return { content: '', error: `File not found: ${filePath}` };
      }
      const stat = fs.statSync(check.fullPath);
      if (stat.isDirectory()) {
        return { content: '', error: `Path is a directory, not a file: ${filePath}` };
      }
      const content = fs.readFileSync(check.fullPath, 'utf-8');
      return { content };
    } catch (e: any) {
      return { content: '', error: e.message };
    }
  }

  public writeFile(filePath: string, content: string): { success: boolean; error?: string } {
    const check = this.resolvePath(filePath);
    if (!check.safe) return { success: false, error: check.error };
    try {
      const dir = path.dirname(check.fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(check.fullPath, content, 'utf-8');
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  public editFile(filePath: string, findText: string, replaceText: string): { success: boolean; error?: string } {
    const read = this.readFile(filePath);
    if (read.error) return { success: false, error: read.error };
    if (!read.content.includes(findText)) {
      return { success: false, error: `Target text to replace not found in ${filePath}` };
    }
    const newContent = read.content.replace(findText, replaceText);
    return this.writeFile(filePath, newContent);
  }

  public deletePath(targetPath: string): { success: boolean; error?: string } {
    const check = this.resolvePath(targetPath);
    if (!check.safe) return { success: false, error: check.error };
    try {
      if (!fs.existsSync(check.fullPath)) {
        return { success: false, error: `Path not found: ${targetPath}` };
      }
      const stat = fs.statSync(check.fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(check.fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(check.fullPath);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  public movePath(source: string, destination: string): { success: boolean; error?: string } {
    const srcCheck = this.resolvePath(source);
    const destCheck = this.resolvePath(destination);
    if (!srcCheck.safe) return { success: false, error: srcCheck.error };
    if (!destCheck.safe) return { success: false, error: destCheck.error };
    try {
      const destDir = path.dirname(destCheck.fullPath);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(srcCheck.fullPath, destCheck.fullPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  public makeDir(dirPath: string): { success: boolean; error?: string } {
    const check = this.resolvePath(dirPath);
    if (!check.safe) return { success: false, error: check.error };
    try {
      fs.mkdirSync(check.fullPath, { recursive: true });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  public listDir(targetDir: string = '.', maxDepth: number = 3): { items: any[]; error?: string } {
    const check = this.resolvePath(targetDir);
    if (!check.safe) return { items: [], error: check.error };
    try {
      if (!fs.existsSync(check.fullPath)) {
        return { items: [], error: `Directory not found: ${targetDir}` };
      }
      const items: any[] = [];
      const traverse = (currentPath: string, relPath: string, depth: number) => {
        if (depth > maxDepth) return;
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.venv' || entry.name === '__pycache__') {
            continue;
          }
          const itemRel = path.join(relPath, entry.name);
          const itemFull = path.join(currentPath, entry.name);
          if (entry.isDirectory()) {
            items.push({ name: entry.name, path: itemRel, type: 'directory' });
            traverse(itemFull, itemRel, depth + 1);
          } else {
            const stat = fs.statSync(itemFull);
            items.push({ name: entry.name, path: itemRel, type: 'file', size: stat.size });
          }
        }
      };
      traverse(check.fullPath, '', 1);
      return { items };
    } catch (e: any) {
      return { items: [], error: e.message };
    }
  }

  public searchFiles(pattern: string): { results: string[]; error?: string } {
    try {
      const globRegex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');
      const list = this.listDir('.', 5);
      if (list.error) return { results: [], error: list.error };
      const matched = list.items
        .filter(item => item.type === 'file' && (globRegex.test(item.name) || globRegex.test(item.path)))
        .map(item => item.path);
      return { results: matched };
    } catch (e: any) {
      return { results: [], error: e.message };
    }
  }

  public grep(query: string, filePattern?: string): { matches: any[]; error?: string } {
    try {
      const list = this.listDir('.', 5);
      if (list.error) return { matches: [], error: list.error };
      const matches: any[] = [];
      const fileRegex = filePattern ? new RegExp(filePattern.replace(/\*/g, '.*'), 'i') : null;
      for (const item of list.items) {
        if (item.type !== 'file') continue;
        if (fileRegex && !fileRegex.test(item.name)) continue;
        const read = this.readFile(item.path);
        if (read.error || !read.content) continue;
        const lines = read.content.split('\n');
        lines.forEach((line, idx) => {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            matches.push({ file: item.path, line: idx + 1, text: line.trim() });
          }
        });
      }
      return { matches: matches.slice(0, 50) };
    } catch (e: any) {
      return { matches: [], error: e.message };
    }
  }

  public runCommand(cmd: string): { stdout: string; stderr: string; exitCode: number } {
    // Check dangerous commands
    for (const pattern of Sandbox.DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(cmd)) {
        return {
          stdout: '',
          stderr: `[Miss Data Sandbox Security] Command blocked by safety guard deny-list: '${cmd}'`,
          exitCode: 126,
        };
      }
    }

    try {
      // Execute in sandbox cwd
      const output = execSync(cmd, {
        cwd: this.cwd,
        timeout: 10000,
        encoding: 'utf-8',
        maxBuffer: 1024 * 512,
      });
      return { stdout: output, stderr: '', exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ? err.stdout.toString() : '',
        stderr: err.stderr ? err.stderr.toString() : err.message,
        exitCode: err.status ?? 1,
      };
    }
  }
}
