import { describe, expect, it } from "vitest";
import { Console, MAX_HISTORY, MAX_INPUT, MAX_LINES, parseWords, type ConsoleCommand } from "../../src/game/console.ts";

const texts = (con: Console): string[] => con.lines.map((line) => line.text);

/** Types a line and presses Enter, then lets its command run. */
async function enter(con: Console, line: string): Promise<void> {
  con.type(line);
  con.key({ key: "Enter" });
  await Promise.resolve();
}

/** A console with a command that records what it's given and offers values for its first argument, and two that share a start. */
function withEcho(): { con: Console; calls: string[][] } {
  const con = new Console();
  const calls: string[][] = [];
  const echo: ConsoleCommand = {
    name: "echo",
    usage: "<words>",
    help: "says the words",
    run: (args) => void calls.push([...args]),
    complete: (index) => (index === 0 ? ["alpha", "alps", "beta"] : []),
  };
  con.register(echo, { name: "map", help: "loads a map", run: () => {} }, { name: "maps", help: "lists maps", run: () => {} });
  return { con, calls };
}

describe("parseWords", () => {
  it("splits on whitespace, as Quake did", () => {
    expect(parseWords("  map   greybox_01 ")).toEqual(["map", "greybox_01"]);
    expect(parseWords("")).toEqual([]);
  });

  it("keeps a quoted word whole, spaces and all", () => {
    expect(parseWords('say "hello there" now')).toEqual(["say", "hello there", "now"]);
    expect(parseWords('record ""')).toEqual(["record", ""]);
    expect(parseWords('say "open to the end')).toEqual(["say", "open to the end"]);
  });
});

describe("Console", () => {
  it("runs a command with its words, by name in any case", async () => {
    const { con, calls } = withEcho();
    await con.run('ECHO one "two three"');
    expect(calls).toEqual([["one", "two three"]]);
  });

  it("says when a command doesn't exist, or fails", async () => {
    const con = new Console();
    con.register({ name: "boom", help: "fails", run: () => Promise.reject(new Error("it broke")) });
    await con.run("nope");
    await con.run("boom");
    expect(con.lines).toEqual([
      { text: 'unknown command "nope" (help lists them)', warning: true },
      { text: "boom: it broke", warning: true },
    ]);
  });

  it("echoes what's entered, clears the line, and keeps it in the history", async () => {
    const { con, calls } = withEcho();
    await enter(con, "echo hi");
    expect(texts(con)).toEqual(["] echo hi"]);
    expect(calls).toEqual([["hi"]]);
    expect([con.input, con.cursor]).toEqual(["", 0]);
    con.key({ key: "ArrowUp" });
    expect([con.input, con.cursor]).toEqual(["echo hi", 7]);
  });

  it("edits the line at the cursor", () => {
    const con = new Console();
    con.type("mpa");
    con.key({ key: "ArrowLeft" });
    con.key({ key: "ArrowLeft" });
    con.key({ key: "Backspace" });
    con.type("ma");
    con.key({ key: "End" });
    con.key({ key: "Backspace" });
    con.type("s");
    expect(con.input).toBe("maps");
    con.key({ key: "Home" });
    con.key({ key: "Delete" });
    expect([con.input, con.cursor]).toEqual(["aps", 0]);
    con.key({ key: "Backspace" }); // nothing before the cursor
    con.key({ key: "ArrowLeft" });
    expect([con.input, con.cursor]).toEqual(["aps", 0]);
  });

  it("types printable characters, AltGr's included, and leaves shortcuts to the browser", () => {
    const con = new Console();
    expect(con.key({ key: "a" })).toBe(true);
    expect(con.key({ key: "@", ctrlKey: true, altKey: true })).toBe(true); // AltGr+Q on a German layout
    expect(con.key({ key: "v", ctrlKey: true })).toBe(false); // the browser pastes
    expect(con.key({ key: "r", metaKey: true })).toBe(false);
    expect(con.key({ key: "F5" })).toBe(false);
    expect(con.key({ key: "Shift" })).toBe(false);
    expect(con.input).toBe("a@");
  });

  it("types pasted text as one line, up to the longest line", () => {
    const con = new Console();
    con.type("map\r\ngreybox_01\t\x07x");
    expect(con.input).toBe("map greybox_01 x");
    con.type("y".repeat(MAX_INPUT));
    expect(con.input).toHaveLength(MAX_INPUT);
  });

  it("keeps lines as the font draws them, so wrapping counts the cells drawn", () => {
    const con = new Console();
    con.print("loaded\tChâteau…\nRanger’s", true);
    expect(con.lines).toEqual([
      { text: "loaded  Chateau...", warning: true },
      { text: "Ranger's", warning: true },
    ]);
  });

  it("types pasted curly quotes as quotes the command line understands", async () => {
    const { con, calls } = withEcho();
    con.type("echo “two words”");
    expect(con.input).toBe('echo "two words"');
    con.key({ key: "Enter" });
    await Promise.resolve();
    expect(calls).toEqual([["two words"]]);
  });

  it("goes back through the history and returns to what was being typed", async () => {
    const con = new Console();
    for (const line of ["one", "two", "two", "", "three"]) await enter(con, line);
    con.type("draft");
    const seen = [];
    for (let i = 0; i < 4; i++) {
      con.key({ key: "ArrowUp" });
      seen.push(con.input);
    }
    expect(seen).toEqual(["three", "two", "one", "one"]); // repeats and blank lines aren't kept
    for (let i = 0; i < 3; i++) con.key({ key: "ArrowDown" });
    expect(con.input).toBe("draft");
    con.key({ key: "ArrowDown" });
    expect(con.input).toBe("draft");
  });

  it("keeps the newest history and scrollback", async () => {
    const con = new Console();
    for (let i = 0; i < MAX_HISTORY + 5; i++) await enter(con, `line ${i}`);
    for (let i = 0; i < MAX_HISTORY + 5; i++) con.key({ key: "ArrowUp" });
    expect(con.input).toBe("line 5");
    con.print(Array.from({ length: MAX_LINES + 1 }, (_, i) => `${i}`).join("\n"));
    expect(con.lines).toHaveLength(MAX_LINES);
    expect(con.lines.at(-1)!.text).toBe(`${MAX_LINES}`);
  });

  it("completes a command's name, fills in what several share, and lists them when that's all it can do", () => {
    const { con } = withEcho();
    con.type("ec");
    con.key({ key: "Tab" });
    expect(con.input).toBe("echo ");
    con.input = "M";
    con.cursor = 1;
    con.key({ key: "Tab" });
    expect(con.input).toBe("map");
    con.key({ key: "Tab" });
    expect(con.input).toBe("map");
    expect(texts(con)).toEqual(["map  maps"]);
  });

  it("completes an argument from the values its command offers", () => {
    const { con } = withEcho();
    con.type("echo al");
    con.key({ key: "Tab" });
    expect(con.input).toBe("echo alp");
    con.type("h");
    con.key({ key: "Tab" });
    expect(con.input).toBe("echo alpha ");
    con.key({ key: "Tab" }); // a second argument, for which nothing is offered
    expect(con.input).toBe("echo alpha ");
  });

  it("completes the word at the cursor, keeping the rest of the line", () => {
    const { con } = withEcho();
    con.type("echo be after");
    con.cursor = "echo be".length;
    con.key({ key: "Tab" });
    expect([con.input, con.cursor]).toEqual(["echo beta after", "echo beta".length]);
  });

  it("pages through the scrollback, never past the newest", () => {
    const con = new Console();
    con.pageRows = 5;
    con.key({ key: "PageUp" });
    con.key({ key: "PageUp" });
    expect(con.scroll).toBe(10);
    con.key({ key: "PageDown" });
    con.scrollBy(-3);
    expect(con.scroll).toBe(2);
    con.scrollBy(-10);
    expect(con.scroll).toBe(0);
  });

  it("lists its commands with what they do, says what one does, and clears", async () => {
    const { con } = withEcho();
    await con.run("help");
    expect(texts(con)).toEqual([
      "  clear           clears the console",
      "  echo <words>    says the words",
      "  help [command]  lists the commands, or says what one does",
      "  map             loads a map",
      "  maps            lists maps",
    ]);
    con.lines.splice(0);
    await con.run("help echo");
    await con.run("help nothing");
    expect(con.lines).toEqual([
      { text: "echo <words>: says the words", warning: false },
      { text: 'no command "nothing" (help lists them)', warning: true },
    ]);
    con.scroll = 4;
    await con.run("clear");
    expect([con.lines, con.scroll]).toEqual([[], 0]);
  });

  it("completes help's argument with the commands", () => {
    const { con } = withEcho();
    con.type("help cl");
    con.key({ key: "Tab" });
    expect(con.input).toBe("help clear ");
  });
});
