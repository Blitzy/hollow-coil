// The console, as in Quake: scrollback, a command line with history and tab
// completion, and the commands it runs. This is what it holds and how keys change
// it; console-view.ts draws it, and main.ts gives it the keyboard while it's open.

import { fontText } from "@mandreljs/render/font";

export interface ConsoleCommand {
  /** What's typed to run it, in lowercase. */
  readonly name: string;
  /** Its arguments, as help shows them: "<name>" for one it needs, "[name]" for one it doesn't. */
  readonly usage?: string;
  /** What it does, in a few words. */
  readonly help: string;
  /** Runs it with the words typed after its name. */
  readonly run: (args: readonly string[]) => void | Promise<void>;
  /** The values an argument can take, by its index from 0, for tab completion. */
  readonly complete?: (index: number) => readonly string[];
}

export interface ConsoleLine {
  readonly text: string;
  /** Something went wrong or needs attention, drawn in another color. */
  readonly warning: boolean;
}

/** A key pressed while the console is open: a KeyboardEvent's key, and its modifiers. */
export interface ConsoleKey {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
}

/** Lines of scrollback kept; older ones are dropped. */
export const MAX_LINES = 1000;
/** Commands kept in the history. */
export const MAX_HISTORY = 100;
/** The longest command line, as Quake's. */
export const MAX_INPUT = 256;

/**
 * Splits a command line into words, as Quake did: whitespace separates them, and a word starting with a double quote
 * runs to the next one, spaces and all ("" is an empty word). A quote left open runs to the end of the line.
 */
export function parseWords(line: string): string[] {
  const words: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i]!)) {
      i++;
    } else if (line[i] === '"') {
      const end = line.indexOf('"', i + 1);
      words.push(line.slice(i + 1, end < 0 ? line.length : end));
      i = end < 0 ? line.length : end + 1;
    } else {
      const start = i;
      while (i < line.length && !/\s/.test(line[i]!)) i++;
      words.push(line.slice(start, i));
    }
  }
  return words;
}

/** The longest start all the words share, ignoring case, in the first word's case. */
function sharedStart(words: readonly string[]): string {
  let length = words[0]!.length;
  for (const word of words) {
    while (word.slice(0, length).toLowerCase() !== words[0]!.slice(0, length).toLowerCase()) length--;
  }
  return words[0]!.slice(0, length);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class Console {
  readonly lines: ConsoleLine[] = [];
  /** The command line, and the cursor's place in it (0 is before the first character). */
  input = "";
  cursor = 0;
  /** Rows scrolled back from the newest; the view keeps it within the scrollback. */
  scroll = 0;
  /** Rows Page Up and Page Down move, which the view sets to fit what it shows. */
  pageRows = 10;
  private readonly commands = new Map<string, ConsoleCommand>();
  private readonly history: string[] = [];
  /** Which history entry the command line shows, or history.length for the one being typed. */
  private historyIndex = 0;
  /** What was being typed before Up went back through the history. */
  private draft = "";

  constructor() {
    this.register(
      {
        name: "help",
        usage: "[command]",
        help: "lists the commands, or says what one does",
        run: (args) => this.help(args[0]),
        complete: (index) => (index === 0 ? this.names : []),
      },
      {
        name: "clear",
        help: "clears the console",
        run: () => {
          this.lines.splice(0);
          this.scroll = 0;
        },
      },
    );
  }

  register(...commands: readonly ConsoleCommand[]): void {
    for (const command of commands) this.commands.set(command.name, command);
  }

  /** Every command's name, in order. */
  get names(): string[] {
    return [...this.commands.keys()].sort();
  }

  /** Adds text to the scrollback, a line for each of its lines, as the font draws it (see fontText). */
  print(text: string, warning = false): void {
    for (const line of text.split(/\r?\n/)) this.lines.push({ text: fontText(line), warning });
    this.lines.splice(0, Math.max(0, this.lines.length - MAX_LINES));
  }

  warn(text: string): void {
    this.print(text, true);
  }

  /** Runs a command line, saying so if it isn't a command or fails. Resolves when the command is done. */
  async run(line: string): Promise<void> {
    const [name, ...args] = parseWords(line);
    if (name === undefined) return;
    const command = this.commands.get(name.toLowerCase());
    if (command === undefined) return this.warn(`unknown command "${name}" (help lists them)`);
    try {
      await command.run(args);
    } catch (error) {
      this.warn(`${command.name}: ${errorText(error)}`);
    }
  }

  /** Changes the console for a key, returning whether it used the key. Escape and the toggle key are main.ts's. */
  key(press: ConsoleKey): boolean {
    const { key } = press;
    // AltGr arrives as Ctrl and Alt together, and types characters on many layouts.
    const typing = !press.metaKey && (!press.ctrlKey || press.altKey === true);
    if (key.length === 1 && typing) {
      this.type(key);
      return true;
    }
    switch (key) {
      case "Enter":
        this.submit();
        return true;
      case "Backspace":
        if (this.cursor > 0) this.edit(this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor), this.cursor - 1);
        return true;
      case "Delete":
        this.edit(this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1), this.cursor);
        return true;
      case "ArrowLeft":
        this.cursor = Math.max(0, this.cursor - 1);
        return true;
      case "ArrowRight":
        this.cursor = Math.min(this.input.length, this.cursor + 1);
        return true;
      case "Home":
        this.cursor = 0;
        return true;
      case "End":
        this.cursor = this.input.length;
        return true;
      case "ArrowUp":
        this.browse(-1);
        return true;
      case "ArrowDown":
        this.browse(1);
        return true;
      case "PageUp":
        this.scroll += this.pageRows;
        return true;
      case "PageDown":
        this.scroll = Math.max(0, this.scroll - this.pageRows);
        return true;
      case "Tab":
        this.complete();
        return true;
      default:
        return false;
    }
  }

  /**
   * Types text at the cursor, as pasting does: line breaks and tabs become spaces, other control characters are
   * dropped, and the rest is as the font draws it, so pasted curly quotes are quotes the command line understands.
   */
  type(text: string): void {
    const clean = fontText(text.replace(/\r?\n|\t/g, " ").replace(/[\x00-\x1f\x7f]/g, ""));
    const room = MAX_INPUT - this.input.length;
    const typed = clean.slice(0, Math.max(0, room));
    this.edit(this.input.slice(0, this.cursor) + typed + this.input.slice(this.cursor), this.cursor + typed.length);
  }

  /** Moves the scrollback by rows: positive goes back to older lines. */
  scrollBy(rows: number): void {
    this.scroll = Math.max(0, this.scroll + rows);
  }

  /** Runs the command line, echoing it into the scrollback, and keeps it in the history. */
  submit(): void {
    const line = this.input;
    this.print(`] ${line}`);
    if (line.trim() !== "" && this.history.at(-1) !== line) this.history.push(line);
    this.history.splice(0, Math.max(0, this.history.length - MAX_HISTORY));
    this.historyIndex = this.history.length;
    this.edit("", 0);
    this.scroll = 0;
    void this.run(line);
  }

  /**
   * Completes the word before the cursor: a command's name for the first word, otherwise one of the values the command
   * offers for that argument. One match is filled in; several fill in what they share, or, when that adds nothing,
   * are listed in the scrollback.
   */
  complete(): void {
    const before = this.input.slice(0, this.cursor);
    const start = before.search(/\S*$/);
    const prefix = before.slice(start).toLowerCase();
    const words = before.slice(0, start).trim().split(/\s+/).filter((word) => word !== "");
    const offered = words.length === 0 ? this.names : (this.commands.get(words[0]!.toLowerCase())?.complete?.(words.length - 1) ?? []);
    const matches = offered.filter((value) => value.toLowerCase().startsWith(prefix));
    if (matches.length === 0) return;
    const after = this.input.slice(this.cursor);
    const fill = (text: string): void => this.edit(before.slice(0, start) + text + after, start + text.length);
    if (matches.length === 1) return fill(after.startsWith(" ") ? matches[0]! : `${matches[0]!} `);
    const shared = sharedStart(matches);
    if (shared.length > prefix.length) return fill(shared);
    this.print(matches.join("  "));
  }

  private edit(input: string, cursor: number): void {
    this.input = input;
    this.cursor = cursor;
  }

  /** Steps through the history: -1 for older, 1 for newer, back to what was being typed. */
  private browse(step: -1 | 1): void {
    const index = Math.max(0, Math.min(this.history.length, this.historyIndex + step));
    if (index === this.historyIndex) return;
    if (this.historyIndex === this.history.length) this.draft = this.input;
    this.historyIndex = index;
    const line = index === this.history.length ? this.draft : this.history[index]!;
    this.edit(line, line.length);
  }

  private help(name: string | undefined): void {
    const signature = (command: ConsoleCommand): string => (command.usage === undefined ? command.name : `${command.name} ${command.usage}`);
    if (name !== undefined) {
      const command = this.commands.get(name.toLowerCase());
      if (command === undefined) return this.warn(`no command "${name}" (help lists them)`);
      return this.print(`${signature(command)}: ${command.help}`);
    }
    const commands = this.names.map((key) => this.commands.get(key)!);
    const width = Math.max(...commands.map((command) => signature(command).length));
    this.print(commands.map((command) => `  ${signature(command).padEnd(width)}  ${command.help}`).join("\n"));
  }
}
