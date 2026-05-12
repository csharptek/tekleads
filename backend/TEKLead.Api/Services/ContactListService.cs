using System.Text.RegularExpressions;
using Dapper;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ContactListService
{
    private readonly SettingsService _settings;
    private readonly ApolloService   _apollo;
    private readonly ILogger<ContactListService> _log;

    public ContactListService(SettingsService settings, ApolloService apollo, ILogger<ContactListService> log)
    {
        _settings = settings;
        _apollo   = apollo;
        _log      = log;
    }

    private NpgsqlConnection Conn() => new(_settings.ConnectionString);

    // ── Schema ───────────────────────────────────────────────────────────────

    public async Task EnsureSchema()
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS contact_lists (
                id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                title       TEXT        NOT NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS contacts (
                id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                list_id        UUID        NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
                name           TEXT        NOT NULL DEFAULT '',
                title          TEXT        NOT NULL DEFAULT '',
                company        TEXT        NOT NULL DEFAULT '',
                location       TEXT        NOT NULL DEFAULT '',
                email          TEXT        NOT NULL DEFAULT '',
                phone          TEXT        NOT NULL DEFAULT '',
                linkedin_url   TEXT        NOT NULL DEFAULT '',
                apollo_id      TEXT        NOT NULL DEFAULT '',
                enrich_status  TEXT        NOT NULL DEFAULT 'pending',
                enriched_at    TIMESTAMPTZ,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS contact_templates (
                id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                list_id     UUID        NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
                type        TEXT        NOT NULL DEFAULT 'email',
                name        TEXT        NOT NULL DEFAULT '',
                subject     TEXT        NOT NULL DEFAULT '',
                body        TEXT        NOT NULL DEFAULT '',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS contact_outreach_log (
                id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                contact_id  UUID        NOT NULL,
                list_id     UUID        NOT NULL,
                type        TEXT        NOT NULL,
                recipient   TEXT        NOT NULL DEFAULT '',
                status      TEXT        NOT NULL DEFAULT '',
                error       TEXT,
                sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        ");
    }

    // ── Contact Lists CRUD ───────────────────────────────────────────────────

    public async Task<List<ContactList>> GetLists()
    {
        await using var c = Conn();
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>(@"
            SELECT cl.id, cl.title, cl.created_at,
                   COUNT(co.id)                                          AS total,
                   COUNT(co.id) FILTER (WHERE co.enrich_status='enriched') AS enriched,
                   COUNT(co.id) FILTER (WHERE co.enrich_status='pending')  AS not_enriched,
                   COUNT(co.id) FILTER (WHERE co.enrich_status='failed')   AS failed
            FROM contact_lists cl
            LEFT JOIN contacts co ON co.list_id = cl.id
            GROUP BY cl.id, cl.title, cl.created_at
            ORDER BY cl.created_at DESC
        ");
        return rows.Select(r => new ContactList
        {
            Id          = r.id,
            Title       = r.title ?? "",
            CreatedAt   = r.created_at,
            Total       = (int)(r.total ?? 0),
            Enriched    = (int)(r.enriched ?? 0),
            NotEnriched = (int)(r.not_enriched ?? 0),
            Failed      = (int)(r.failed ?? 0),
        }).ToList();
    }

    public async Task<Guid> CreateList(string title)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var id = await c.ExecuteScalarAsync<Guid>(
            "INSERT INTO contact_lists (title) VALUES (@title) RETURNING id",
            new { title });
        return id;
    }

    public async Task DeleteList(Guid id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync("DELETE FROM contact_lists WHERE id=@id", new { id });
    }

    // ── Contacts ─────────────────────────────────────────────────────────────

    public async Task<(List<Contact> Items, int Total)> GetContacts(
        Guid listId, int page, int pageSize, string? search, string? status)
    {
        await using var c = Conn();
        await c.OpenAsync();

        var where = "WHERE list_id=@listId";
        if (!string.IsNullOrEmpty(search))
            where += " AND (name ILIKE @search OR email ILIKE @search OR company ILIKE @search)";
        if (!string.IsNullOrEmpty(status))
            where += " AND enrich_status=@status";

        var searchPat = $"%{search}%";
        var total = await c.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM contacts {where}",
            new { listId, search = searchPat, status });

        var items = await c.QueryAsync<Contact>(
            $@"SELECT id, list_id, name, title, company, location, email, phone,
                      linkedin_url, apollo_id, enrich_status, enriched_at, created_at
               FROM contacts {where}
               ORDER BY created_at ASC
               LIMIT @pageSize OFFSET @offset",
            new { listId, search = searchPat, status, pageSize, offset = (page - 1) * pageSize });

        return (items.ToList(), total);
    }

    // ── Excel Import ─────────────────────────────────────────────────────────

    public async Task<int> ImportExcel(Guid listId, Stream stream)
    {
        var contacts = ParseExcel(stream);
        if (contacts.Count == 0) return 0;

        await using var c = Conn();
        await c.OpenAsync();

        foreach (var co in contacts)
        {
            co.ListId = listId;
            await c.ExecuteAsync(@"
                INSERT INTO contacts
                    (list_id, name, title, company, location, email, phone, linkedin_url, apollo_id, enrich_status)
                VALUES
                    (@ListId, @Name, @Title, @Company, @Location, @Email, @Phone, @LinkedinUrl, @ApolloId, 'pending')
            ", co);
        }
        return contacts.Count;
    }

    private List<Contact> ParseExcel(Stream stream)
    {
        var result = new List<Contact>();
        using var doc = SpreadsheetDocument.Open(stream, false);
        var wbPart  = doc.WorkbookPart!;
        var sheet   = wbPart.WorksheetParts.First();
        var ws      = sheet.Worksheet;
        var rows    = ws.Descendants<Row>().ToList();
        if (rows.Count < 2) return result;

        // Build shared strings table
        var sst = wbPart.SharedStringTablePart?.SharedStringTable;

        string CellValue(Cell? cell)
        {
            if (cell == null) return "";
            var val = cell.InnerText;
            if (cell.DataType?.Value == CellValues.SharedString && sst != null)
            {
                if (int.TryParse(val, out var idx))
                    val = sst.ElementAt(idx).InnerText;
            }
            return val?.Trim() ?? "";
        }

        // Header row — map column letter to field name
        var headerRow  = rows[0];
        var colMap     = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); // colLetter -> fieldName
        foreach (var cell in headerRow.Elements<Cell>())
        {
            var col   = Regex.Match(cell.CellReference?.Value ?? "", @"[A-Z]+").Value;
            var hdr   = CellValue(cell).ToLowerInvariant().Trim();
            colMap[col] = hdr;
        }

        // Normalize: map header text to our field
        static string FieldFor(string hdr) => hdr switch
        {
            "first name"              => "firstname",
            "last name"               => "lastname",
            "name"                    => "name",
            "full name"               => "name",
            "title"                   => "title",
            "job title"               => "title",
            "company"                 => "company",
            "company name"            => "company",
            "company name for emails" => "company",
            "organization"            => "company",
            "email"                   => "email",
            "contact email"           => "email",
            // Apollo phone columns — priority order handled below
            "work direct phone"       => "phone1",
            "mobile phone"            => "phone2",
            "corporate phone"         => "phone3",
            "home phone"              => "phone4",
            "other phone"             => "phone5",
            "phone"                   => "phone1",
            "mobile"                  => "phone2",
            "work phone"              => "phone1",
            "phone number"            => "phone1",
            // LinkedIn
            "person linkedin url"     => "linkedin",
            "linkedin url"            => "linkedin",
            "linkedin"                => "linkedin",
            "contact linkedin url"    => "linkedin",
            // Location
            "city"                    => "city",
            "state"                   => "state",
            "country"                 => "country",
            "location"                => "location",
            // Apollo ID
            "apollo contact id"       => "apolloid",
            _                         => ""
        };

        for (int i = 1; i < rows.Count; i++)
        {
            var row    = rows[i];
            var cells  = row.Elements<Cell>().ToDictionary(
                cell => Regex.Match(cell.CellReference?.Value ?? "", @"[A-Z]+").Value,
                cell => CellValue(cell));

            var data = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (col, hdr) in colMap)
            {
                var field = FieldFor(hdr);
                if (string.IsNullOrEmpty(field)) continue;
                var val = cells.TryGetValue(col, out var v) ? v : "";
                // For phone priority slots: only set if not already set by higher priority
                if (field.StartsWith("phone"))
                {
                    if (!data.ContainsKey(field))
                        data[field] = val;
                }
                else
                {
                    data[field] = val;
                }
            }

            // Pick first non-empty phone in priority order
            var phone = new[] { "phone1", "phone2", "phone3", "phone4", "phone5" }
                .Select(k => data.TryGetValue(k, out var p) ? p : "")
                .FirstOrDefault(p => !string.IsNullOrWhiteSpace(p)) ?? "";

            // Skip blank rows
            if (!data.TryGetValue("name", out var name) || string.IsNullOrWhiteSpace(name))
            {
                var fn = data.TryGetValue("firstname", out var f) ? f : "";
                var ln = data.TryGetValue("lastname",  out var l) ? l : "";
                name   = $"{fn} {ln}".Trim();
            }
            if (string.IsNullOrWhiteSpace(name)) continue;

            // Build location
            var loc = data.TryGetValue("location", out var locVal) && !string.IsNullOrEmpty(locVal)
                ? locVal
                : string.Join(", ", new[]
                    {
                        data.TryGetValue("city",    out var city)    ? city    : "",
                        data.TryGetValue("state",   out var state)   ? state   : "",
                        data.TryGetValue("country", out var country) ? country : "",
                    }.Where(s => !string.IsNullOrEmpty(s)));

            result.Add(new Contact
            {
                Name        = name,
                Title       = data.TryGetValue("title",    out var t)  ? t  : "",
                Company     = data.TryGetValue("company",  out var co) ? co : "",
                Location    = loc,
                Email       = data.TryGetValue("email",    out var em) ? em : "",
                Phone       = phone,
                LinkedinUrl = data.TryGetValue("linkedin", out var li) ? li : "",
                ApolloId    = data.TryGetValue("apolloid", out var ai) ? ai : "",
            });
        }
        return result;
    }

    // ── Enrichment ───────────────────────────────────────────────────────────

    public async Task<(int ok, int failed)> EnrichContacts(IEnumerable<Guid> contactIds, string baseUrl)
    {
        int ok = 0, failed = 0;
        foreach (var cid in contactIds)
        {
            try
            {
                await using var c = Conn();
                await c.OpenAsync();
                var contact = await c.QuerySingleOrDefaultAsync<Contact>(
                    "SELECT * FROM contacts WHERE id=@cid", new { cid });
                if (contact == null) continue;

                // If no Apollo ID yet, search by LinkedIn or name+company
                string apolloId = contact.ApolloId;

                if (string.IsNullOrEmpty(apolloId))
                {
                    Lead? matched = null;
                    if (!string.IsNullOrEmpty(contact.LinkedinUrl))
                    {
                        try { matched = await _apollo.SearchByLinkedIn(contact.LinkedinUrl); }
                        catch (Exception ex) { _log.LogWarning("LinkedIn match failed for {0}: {1}", cid, ex.Message); }
                    }
                    if (matched == null && !string.IsNullOrEmpty(contact.Name))
                    {
                        try
                        {
                            var (leads, _) = await _apollo.Search(
                                contact.Name, null, contact.Company, null, null, 1, 1);
                            matched = leads.FirstOrDefault();
                        }
                        catch (Exception ex) { _log.LogWarning("Apollo search failed for {0}: {1}", cid, ex.Message); }
                    }
                    if (matched != null) apolloId = matched.ApolloId ?? "";
                }

                if (string.IsNullOrEmpty(apolloId))
                {
                    await c.ExecuteAsync(
                        "UPDATE contacts SET enrich_status='failed', enriched_at=NOW() WHERE id=@cid",
                        new { cid });
                    failed++;
                    continue;
                }

                var webhookUrl = $"{baseUrl}/api/contact-lists/phone-webhook/{cid}";
                var (emails, phones, fullName, location, linkedinUrl) =
                    await _apollo.Enrich(apolloId, webhookUrl);

                await c.ExecuteAsync(@"
                    UPDATE contacts SET
                        apollo_id      = @apolloId,
                        email          = CASE WHEN email='' THEN @email ELSE email END,
                        phone          = CASE WHEN phone='' THEN @phone ELSE phone END,
                        linkedin_url   = CASE WHEN linkedin_url='' THEN @linkedin ELSE linkedin_url END,
                        location       = CASE WHEN location='' THEN @location ELSE location END,
                        name           = CASE WHEN @fullName<>'' THEN @fullName ELSE name END,
                        enrich_status  = 'enriched',
                        enriched_at    = NOW()
                    WHERE id=@cid",
                    new
                    {
                        apolloId,
                        email    = emails.Length  > 0 ? emails[0]  : "",
                        phone    = phones.Length  > 0 ? phones[0]  : "",
                        linkedin = linkedinUrl ?? "",
                        location = location    ?? "",
                        fullName = fullName    ?? "",
                        cid
                    });
                ok++;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Enrichment failed for contact {0}", cid);
                await using var c2 = Conn();
                await c2.OpenAsync();
                await c2.ExecuteAsync(
                    "UPDATE contacts SET enrich_status='failed', enriched_at=NOW() WHERE id=@cid",
                    new { cid });
                failed++;
            }
        }
        return (ok, failed);
    }

    public async Task PhoneWebhook(Guid contactId, string[] phones)
    {
        if (phones.Length == 0) return;
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(
            "UPDATE contacts SET phone=@phone WHERE id=@contactId AND phone=''",
            new { phone = phones[0], contactId });
    }

    // ── Templates ────────────────────────────────────────────────────────────

    public async Task<List<ContactTemplate>> GetTemplates(Guid listId)
    {
        await using var c = Conn();
        await c.OpenAsync();
        return (await c.QueryAsync<ContactTemplate>(
            "SELECT * FROM contact_templates WHERE list_id=@listId ORDER BY created_at ASC",
            new { listId })).ToList();
    }

    public async Task<Guid> UpsertTemplate(ContactTemplate t)
    {
        await using var c = Conn();
        await c.OpenAsync();
        if (t.Id == Guid.Empty)
        {
            return await c.ExecuteScalarAsync<Guid>(@"
                INSERT INTO contact_templates (list_id, type, name, subject, body)
                VALUES (@ListId, @Type, @Name, @Subject, @Body)
                RETURNING id", t);
        }
        await c.ExecuteAsync(@"
            UPDATE contact_templates
            SET type=@Type, name=@Name, subject=@Subject, body=@Body
            WHERE id=@Id AND list_id=@ListId", t);
        return t.Id;
    }

    public async Task DeleteTemplate(Guid id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync("DELETE FROM contact_templates WHERE id=@id", new { id });
    }

    // ── Outreach Log ─────────────────────────────────────────────────────────

    public async Task LogOutreach(ContactOutreachLog log)
    {
        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            INSERT INTO contact_outreach_log (contact_id, list_id, type, recipient, status, error)
            VALUES (@ContactId, @ListId, @Type, @Recipient, @Status, @Error)", log);
    }

    public async Task<List<ContactOutreachLog>> GetOutreachLog(Guid listId)
    {
        await using var c = Conn();
        await c.OpenAsync();
        return (await c.QueryAsync<ContactOutreachLog>(
            "SELECT * FROM contact_outreach_log WHERE list_id=@listId ORDER BY sent_at DESC LIMIT 200",
            new { listId })).ToList();
    }
}
