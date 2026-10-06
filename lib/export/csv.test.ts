import { BOM, csvCell, csvRow, neutraliseFormula, toCsv, toCsvParts } from "./csv";

describe("csvCell", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("Squat")).toBe("Squat");
  });

  it("quotes a comma so it stays one cell", () => {
    expect(csvCell("heavy, grindy")).toBe('"heavy, grindy"');
  });

  it("doubles quotes inside a quoted cell", () => {
    expect(csvCell('felt "easy"')).toBe('"felt ""easy"""');
  });

  it("quotes line breaks, both kinds", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("line one\r\nline two")).toBe('"line one\r\nline two"');
  });

  it("quotes leading or trailing spaces so importers do not trim them", () => {
    expect(csvCell(" padded ")).toBe('" padded "');
  });

  it("writes numbers as numbers", () => {
    expect(csvCell(142.5)).toBe("142.5");
    expect(csvCell(0)).toBe("0");
  });

  it("writes nothing for missing and non-finite values", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("writes booleans as Yes / No, which no locale reinterprets", () => {
    expect(csvCell(true)).toBe("Yes");
    expect(csvCell(false)).toBe("No");
  });

  it("keeps non-ASCII text intact", () => {
    expect(csvCell("Siobhán — pause squat 💪")).toBe("Siobhán — pause squat 💪");
  });
});

describe("formula injection", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1:A2)", "\t=1", "\r=1"])("neutralises %j", (text) => {
    expect(neutraliseFormula(text)).toBe(`'${text}`);
  });

  it("leaves text that merely contains a trigger alone", () => {
    expect(neutraliseFormula("a=b")).toBe("a=b");
    expect(neutraliseFormula("5-3-1")).toBe("5-3-1");
  });

  it("neutralises before quoting, so the apostrophe sits inside the quotes", () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`);
  });

  it("never touches a number, even a negative one", () => {
    expect(csvCell(-5)).toBe("-5");
  });

  it("neutralises a typed exercise name too", () => {
    expect(csvRow(["-pause squat", 100])).toBe("'-pause squat,100");
  });
});

describe("toCsv", () => {
  it("starts with a UTF-8 byte order mark, once", () => {
    const text = toCsv(["A"], [["x"]]);
    expect(text.startsWith(BOM)).toBe(true);
    expect(text.indexOf(BOM, 1)).toBe(-1);
  });

  it("encodes the BOM as EF BB BF", () => {
    const bytes = new TextEncoder().encode(toCsv(["A"], []));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("separates and ends rows with CRLF", () => {
    expect(toCsv(["A", "B"], [[1, 2], [3, 4]])).toBe(`${BOM}A,B\r\n1,2\r\n3,4\r\n`);
  });

  it("keeps a multi-line note as one record", () => {
    const text = toCsv(["Note", "Reps"], [["a\nb, c", 5]]);
    expect(text).toBe(`${BOM}Note,Reps\r\n"a\nb, c",5\r\n`);
  });
});

describe("toCsvParts", () => {
  const header = ["N", "Note"];
  const rows = Array.from({ length: 1234 }, (_, i) => [i, i % 7 === 0 ? `=bad ${i}` : `ok, ${i}`]);

  it("produces exactly the same bytes as toCsv", async () => {
    const parts = await toCsvParts(header, rows, { rowsPerChunk: 100, yieldToMain: async () => {} });
    expect(parts.join("")).toBe(toCsv(header, rows));
  });

  it("yields between chunks but not after the last", async () => {
    let yields = 0;
    await toCsvParts(header, rows, { rowsPerChunk: 500, yieldToMain: async () => void yields++ });
    // 1234 rows in 500s is three chunks, so two gaps.
    expect(yields).toBe(2);
  });

  it("handles an empty log as a header-only file", async () => {
    const parts = await toCsvParts(header, [], { yieldToMain: async () => {} });
    expect(parts.join("")).toBe(`${BOM}N,Note\r\n`);
  });
});
