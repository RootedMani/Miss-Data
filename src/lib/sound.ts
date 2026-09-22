// Web Audio API terminal sound synthesizer
// Provides subtle, nostalgic, non-intrusive sound effects for CLI interactions.

class TerminalSoundManager {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;
  private volume: number = 0.4; // Master scaling factor

  constructor() {
    try {
      const saved = localStorage.getItem('miss_data_sound_enabled');
      if (saved !== null) {
        this.enabled = saved === 'true';
      }
    } catch {
      // Storage unavailable
    }
  }

  private initCtx(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public toggleSound(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('miss_data_sound_enabled', String(this.enabled));
    } catch {
      // Storage unavailable
    }
    if (this.enabled) {
      this.playTabComplete();
    }
    return this.enabled;
  }

  /**
   * Subtle mechanical key/execute click when a command is submitted (Enter)
   */
  public playCommandExecute() {
    if (!this.enabled) return;
    try {
      const ctx = this.initCtx();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      // Filtered frequency burst simulating a mechanical switch
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.035);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, ctx.currentTime);

      gain.gain.setValueAtTime(0.04 * this.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.035);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.038);
    } catch {
      // AudioContext failure recovery
    }
  }

  /**
   * Subtle success blip when command finishes successfully (exit 0)
   */
  public playCommandSuccess() {
    if (!this.enabled) return;
    try {
      const ctx = this.initCtx();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.06);

      gain.gain.setValueAtTime(0.025 * this.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.085);
    } catch {
      // Ignore
    }
  }

  /**
   * Terminal Bell / Error alert when a command fails or exit code !== 0
   */
  public playCommandError() {
    if (!this.enabled) return;
    try {
      const ctx = this.initCtx();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Two-tone soft retro terminal bell
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(260, now);
      osc1.frequency.exponentialRampToValueAtTime(210, now + 0.16);

      osc2.frequency.setValueAtTime(195, now);
      osc2.frequency.exponentialRampToValueAtTime(155, now + 0.16);

      gain.gain.setValueAtTime(0.045 * this.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.17);
      osc2.stop(now + 0.17);
    } catch {
      // Ignore
    }
  }

  /**
   * Micro-click when tab autocompletes
   */
  public playTabComplete() {
    if (!this.enabled) return;
    try {
      const ctx = this.initCtx();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(750, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(950, ctx.currentTime + 0.025);

      gain.gain.setValueAtTime(0.02 * this.volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.025);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.028);
    } catch {
      // Ignore
    }
  }
}

export const terminalSound = new TerminalSoundManager();
