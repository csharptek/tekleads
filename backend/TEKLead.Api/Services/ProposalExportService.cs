using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ProposalExportService
{
    private readonly SettingsService _settings;
    private readonly ProposalService _proposals;
    private readonly ILogger<ProposalExportService> _log;

    private const string AccentDark  = "0F172A";
    private const string AccentBlue  = "2563EB";
    private const string Muted       = "64748B";
    private const string BorderColor = "E2E8F0";
    private const string Red         = "DC2626";

    public ProposalExportService(SettingsService settings, ProposalService proposals, ILogger<ProposalExportService> log)
    {
        _settings = settings; _proposals = proposals; _log = log;
    }

    public async Task<(byte[] Bytes, string FileName)> ExportWord(Guid proposalId)
    {
        var proposal = await _proposals.GetById(proposalId);
        if (proposal == null) throw new Exception("Proposal not found.");
        if (string.IsNullOrWhiteSpace(proposal.GeneratedResponse))
            throw new Exception("No generated content. Generate the proposal first.");

        var all      = await _settings.GetAll();
        var company  = all.GetValueOrDefault("proposal_company_name",         "CSharpTek");
        var signer   = all.GetValueOrDefault("proposal_signer_name",          "Bhanu");
        var signerT  = all.GetValueOrDefault("proposal_signer_title",         "Lead Developer & Project Manager");
        var website  = all.GetValueOrDefault("proposal_website",              "");
        var confText = all.GetValueOrDefault("proposal_confidentiality_text", "This document is intended solely for the recipient and may not be shared without written consent.");
        var footerTx = all.GetValueOrDefault("proposal_footer_text",          $"Confidential · {company}");

        var client   = proposal.ClientName    ?? "";
        var clientCo = proposal.ClientCompany ?? "";
        var headline = !string.IsNullOrWhiteSpace(proposal.JobPostHeadline)
            ? proposal.JobPostHeadline
            : (proposal.JobPostBody?.Length > 0 ? proposal.JobPostBody[..Math.Min(80, proposal.JobPostBody.Length)] : "Project Proposal");
        var dateStr  = DateTime.UtcNow.ToString("MMMM yyyy");
        var budget   = FormatBudget(proposal.BudgetMin, proposal.BudgetMax);
        var timeline = proposal.TimelineValue != null ? $"{proposal.TimelineValue} {proposal.TimelineUnit}" : "";

        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            main.Document = new Document(new Body());
            var body = main.Document.Body!;

            AddNumbering(main);
            AddStyles(main);
            AddSettings(main);

            // Cover
            body.AppendChild(CP(company.ToUpper(),    36, AccentBlue,  bold: true,  center: true, spaceBefore: 1440));
            body.AppendChild(CP(!string.IsNullOrEmpty(client) ? client : clientCo, 44, AccentDark, bold: true, center: true, spaceBefore: 100));
            body.AppendChild(CP(headline,              22, Muted,       center: true, spaceBefore: 80));
            body.AppendChild(CP($"PROPOSAL  ·  {dateStr}", 18, Muted, center: true, spaceBefore: 200, spaceAfter: 200, topBorder: true, botBorder: true));
            if (!string.IsNullOrEmpty(budget))
                body.AppendChild(CP($"Investment: {budget}", 22, AccentBlue, bold: true, center: true, spaceBefore: 80));
            if (!string.IsNullOrEmpty(timeline))
                body.AppendChild(CP($"Timeline: {timeline}", 20, Muted, center: true, spaceBefore: 40));
            body.AppendChild(CP($"Prepared by {signer}  |  {company}", 18, Muted, center: true, spaceBefore: 400));
            if (!string.IsNullOrEmpty(client) || !string.IsNullOrEmpty(clientCo))
                body.AppendChild(CP($"Prepared for {client}{(client.Length > 0 && clientCo.Length > 0 ? " · " : "")}{clientCo}", 18, Muted, center: true));
            body.AppendChild(CP("CONFIDENTIAL", 16, Red, bold: true, center: true, spaceBefore: 280));
            body.AppendChild(CP(confText, 15, Muted, center: true, italics: true));
            body.AppendChild(new Paragraph(new Run(new Break { Type = BreakValues.Page })));

            // Header/Footer
            AddHeaderFooter(main, company, headline, footerTx, website);

            // Body from generated markdown
            int numCounter = 1;
            foreach (var rawLine in proposal.GeneratedResponse.Split('\n'))
            {
                var line = rawLine.TrimEnd();
                if (line.StartsWith("# "))
                    body.AppendChild(H1(line[2..].Trim()));
                else if (line.StartsWith("## "))
                    body.AppendChild(H2(line[3..].Trim()));
                else if (line.StartsWith("### "))
                    body.AppendChild(H3(line[4..].Trim()));
                else if (line.StartsWith("|") && line.EndsWith("|"))
                {
                    if (line.Contains("---")) continue;
                    var cells = line.Split('|').Select(c => c.Trim()).Where(c => c.Length > 0).ToArray();
                    body.AppendChild(TableRow(cells));
                }
                else if (line.StartsWith("- ") || line.StartsWith("* "))
                    body.AppendChild(BulletP(Strip(line[2..].Trim())));
                else if (Regex.IsMatch(line, @"^\d+\.\s"))
                {
                    body.AppendChild(NumberedP(Strip(Regex.Replace(line, @"^\d+\.\s", "").Trim()), numCounter++));
                }
                else if (string.IsNullOrWhiteSpace(line) || line.Trim() == "---")
                {
                    numCounter = 1;
                    body.AppendChild(new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "80", After = "0" })));
                }
                else
                {
                    numCounter = 1;
                    body.AppendChild(BP(Strip(line)));
                }
            }

            // Signature
            body.AppendChild(new Paragraph(new ParagraphProperties(
                new SpacingBetweenLines { Before = "240", After = "0" },
                new ParagraphBorders(new TopBorder { Val = BorderValues.Single, Size = 2, Color = BorderColor, Space = 4 })
            )));
            body.AppendChild(BP($"{signer}  |  {signerT}", bold: true));
            body.AppendChild(BP(company, color: Muted));
            if (!string.IsNullOrEmpty(website)) body.AppendChild(BP(website, color: AccentBlue));
            body.AppendChild(BP(dateStr, color: Muted));

            if (!(body.LastChild is Paragraph)) body.AppendChild(new Paragraph());
            main.Document.Save();
        }

        var suffix = string.IsNullOrWhiteSpace(clientCo) ? client : clientCo;
        return (ms.ToArray(), $"Proposal_{San(suffix)}_{DateTime.UtcNow:yyyyMMdd}.docx");
    }

    // ── Paragraph helpers ──────────────────────────────────────────────────────

    private static Paragraph CP(string text, int halfPts, string color, bool bold = false,
        bool center = false, bool italics = false, int spaceBefore = 60, int spaceAfter = 60,
        bool topBorder = false, bool botBorder = false)
    {
        var pPr = new ParagraphProperties();
        if (center) pPr.AppendChild(new Justification { Val = JustificationValues.Center });
        pPr.AppendChild(new SpacingBetweenLines { Before = spaceBefore.ToString(), After = spaceAfter.ToString() });
        if (topBorder || botBorder)
        {
            var pb = new ParagraphBorders();
            if (topBorder) pb.AppendChild(new TopBorder    { Val = BorderValues.Single, Size = 2, Color = BorderColor, Space = 8 });
            if (botBorder) pb.AppendChild(new BottomBorder { Val = BorderValues.Single, Size = 2, Color = BorderColor, Space = 8 });
            pPr.AppendChild(pb);
        }
        return new Paragraph(pPr, MR(text, halfPts, color, bold, italics));
    }

    private static Paragraph H1(string t) => new(
        new ParagraphProperties(
            new SpacingBetweenLines { Before = "320", After = "120" },
            new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Size = 6, Color = AccentBlue, Space = 6 })
        ), MR(t, 28, AccentDark, bold: true));

    private static Paragraph H2(string t) => new(
        new ParagraphProperties(new SpacingBetweenLines { Before = "200", After = "80" }),
        MR(t, 24, AccentDark, bold: true));

    private static Paragraph H3(string t) => new(
        new ParagraphProperties(new SpacingBetweenLines { Before = "160", After = "60" }),
        MR(t, 22, AccentDark, bold: true));

    private static Paragraph BP(string text, bool bold = false, string? color = null) => new(
        new ParagraphProperties(new SpacingBetweenLines { Before = "60", After = "60" }),
        MR(text, 22, color ?? "000000", bold));

    private static Paragraph BulletP(string text) => new(
        new ParagraphProperties(
            new ParagraphStyleId { Val = "ListParagraph" },
            new NumberingProperties(new NumberingLevelReference { Val = 0 }, new NumberingId { Val = 1 }),
            new SpacingBetweenLines { Before = "40", After = "40" }
        ), MR(text, 22, "000000"));

    private static Paragraph NumberedP(string text, int _) => new(
        new ParagraphProperties(
            new ParagraphStyleId { Val = "ListParagraph" },
            new NumberingProperties(new NumberingLevelReference { Val = 0 }, new NumberingId { Val = 2 }),
            new SpacingBetweenLines { Before = "40", After = "40" }
        ), MR(text, 22, "000000"));

    private static Paragraph TableRow(string[] cells)
    {
        var p = new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "40", After = "40" }));
        for (int i = 0; i < cells.Length; i++)
        {
            if (i > 0) p.AppendChild(MR("   ", 20, Muted));
            p.AppendChild(MR(cells[i].Replace("**",""), 20, i == 0 && cells.Length > 1 ? AccentDark : "000000", i == 0 && cells.Length > 1));
        }
        return p;
    }

    private static Run MR(string text, int halfPts, string color, bool bold = false, bool italics = false)
    {
        var rPr = new RunProperties(
            new RunFonts { Ascii = "Arial", HighAnsi = "Arial" },
            new Color { Val = color },
            new FontSize { Val = halfPts.ToString() },
            new FontSizeComplexScript { Val = halfPts.ToString() }
        );
        if (bold)    rPr.AppendChild(new Bold());
        if (italics) rPr.AppendChild(new Italic());
        return new Run(rPr, new Text(text) { Space = SpaceProcessingModeValues.Preserve });
    }

    // ── Styles / Numbering / Settings ─────────────────────────────────────────

    private static void AddStyles(MainDocumentPart main)
    {
        var sp = main.AddNewPart<StyleDefinitionsPart>();
        sp.Styles = new Styles(
            new DocDefaults(new RunPropertiesDefault(new RunPropertiesBaseStyle(
                new RunFonts { Ascii = "Arial", HighAnsi = "Arial" },
                new FontSize { Val = "22" }
            ))),
            MkStyle("Heading1",       "Heading 1",       28, AccentDark, bold: true, outline: 0),
            MkStyle("Heading2",       "Heading 2",       24, AccentDark, bold: true, outline: 1),
            MkStyle("ListParagraph",  "List Paragraph",  22, "000000",   indLeft: 720, indHanging: 360)
        );
    }

    private static Style MkStyle(string id, string name, int halfPts, string color,
        bool bold = false, int outline = -1, int indLeft = 0, int indHanging = 0)
    {
        var s = new Style { Type = StyleValues.Paragraph, StyleId = id };
        s.AppendChild(new StyleName { Val = name });
        var rPr = new StyleRunProperties(
            new RunFonts { Ascii = "Arial", HighAnsi = "Arial" },
            new Color { Val = color },
            new FontSize { Val = halfPts.ToString() }
        );
        if (bold) rPr.AppendChild(new Bold());
        s.AppendChild(rPr);
        var pPr = new StyleParagraphProperties();
        if (outline >= 0) pPr.AppendChild(new OutlineLevel { Val = outline });
        if (indLeft > 0)  pPr.AppendChild(new Indentation { Left = indLeft.ToString(), Hanging = indHanging.ToString() });
        s.AppendChild(pPr);
        return s;
    }

    private static void AddNumbering(MainDocumentPart main)
    {
        var np = main.AddNewPart<NumberingDefinitionsPart>();
        np.Numbering = new Numbering(
            new AbstractNum(new Level(
                new NumberingFormat { Val = NumberFormatValues.Bullet },
                new LevelText { Val = "•" },
                new LevelJustification { Val = LevelJustificationValues.Left },
                new PreviousParagraphProperties(new Indentation { Left = "720", Hanging = "360" })
            ) { LevelIndex = 0 }) { AbstractNumberId = 1 },
            new AbstractNum(new Level(
                new NumberingFormat { Val = NumberFormatValues.Decimal },
                new LevelText { Val = "%1." },
                new LevelJustification { Val = LevelJustificationValues.Left },
                new PreviousParagraphProperties(new Indentation { Left = "720", Hanging = "360" })
            ) { LevelIndex = 0 }) { AbstractNumberId = 2 },
            new NumberingInstance(new AbstractNumId { Val = 1 }) { NumberID = 1 },
            new NumberingInstance(new AbstractNumId { Val = 2 }) { NumberID = 2 }
        );
    }

    private static void AddSettings(MainDocumentPart main)
    {
        var sp = main.AddNewPart<DocumentSettingsPart>();
        sp.Settings = new Settings(new Compatibility(new CompatibilitySetting
        {
            Name = CompatSettingNameValues.CompatibilityMode,
            Uri  = new Uri("http://schemas.microsoft.com/office/word"),
            Val  = "15"
        }));
    }

    private static void AddHeaderFooter(MainDocumentPart main, string company, string headline, string footerText, string website)
    {
        var hp = main.AddNewPart<HeaderPart>();
        hp.Header = new Header(new Paragraph(
            new ParagraphProperties(
                new SpacingBetweenLines { After = "100" },
                new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Size = 6, Color = AccentBlue, Space = 4 }),
                new Tabs(new TabStop { Val = TabStopValues.Right, Position = 9360 })
            ),
            MR($"{company}  |  {headline[..Math.Min(60, headline.Length)]}", 18, Muted),
            new Run(new TabChar()),
            MR("CONFIDENTIAL", 18, Red, bold: true)
        ));

        var fp = main.AddNewPart<FooterPart>();
        fp.Footer = new Footer(new Paragraph(
            new ParagraphProperties(
                new SpacingBetweenLines { Before = "80" },
                new ParagraphBorders(new TopBorder { Val = BorderValues.Single, Size = 2, Color = BorderColor, Space = 4 }),
                new Tabs(new TabStop { Val = TabStopValues.Right, Position = 9360 })
            ),
            MR($"{company}{(string.IsNullOrEmpty(website) ? "" : $"  ·  {website}")}", 18, Muted),
            new Run(new TabChar()),
            MR(footerText, 18, Muted)
        ));

        main.Document.Body!.AppendChild(new SectionProperties(
            new PageSize { Width = 12240, Height = 15840 },
            new PageMargin { Top = 1200, Right = 1440, Bottom = 1200, Left = 1440 },
            new HeaderReference { Type = HeaderFooterValues.Default, Id = main.GetIdOfPart(hp) },
            new FooterReference { Type = HeaderFooterValues.Default, Id = main.GetIdOfPart(fp) }
        ));
    }

    private static string FormatBudget(decimal? min, decimal? max)
    {
        if (min == null && max == null) return "";
        if (min != null && max != null) return $"${min:N0} – ${max:N0} USD";
        return $"${(min ?? max):N0} USD";
    }

    private static string Strip(string s) => Regex.Replace(s, @"\*\*(.*?)\*\*", "$1").Replace("**", "").Trim();

    private static string San(string? s) =>
        string.IsNullOrWhiteSpace(s) ? "Proposal" : new string(s.Where(c => char.IsLetterOrDigit(c) || c == '_').ToArray());
}
