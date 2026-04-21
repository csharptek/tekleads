using Npgsql;
using Dapper;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class DbService
{
    private readonly SettingsService _settings;
    public DbService(SettingsService settings) => _settings = settings;

    private async Task<NpgsqlConnection> Connect()
    {
        var s = await _settings.GetSettings();
        var conn = new NpgsqlConnection(s.PgConnectionString);
        await conn.OpenAsync();
        return conn;
    }

    public async Task<List<Project>> GetProjects()
    {
        await using var conn = await Connect();
        var rows = await conn.QueryAsync<dynamic>(
            "SELECT id, title, industry, tags, problem, solution, tech_stack, outcomes, links, created_at FROM projects ORDER BY created_at DESC");
        return rows.Select(r => new Project
        {
            Id = r.id, Title = r.title ?? "", Industry = r.industry ?? "",
            Tags = (r.tags as string[]) ?? [], Problem = r.problem ?? "",
            Solution = r.solution ?? "", TechStack = r.tech_stack ?? "",
            Outcomes = r.outcomes ?? "", Links = r.links ?? "", CreatedAt = r.created_at,
        }).ToList();
    }

    public async Task<Project> InsertProject(Project p)
    {
        await using var conn = await Connect();
        await conn.ExecuteAsync(
            "INSERT INTO projects (id,title,industry,tags,problem,solution,tech_stack,outcomes,links) VALUES (@Id,@Title,@Industry,@Tags,@Problem,@Solution,@TechStack,@Outcomes,@Links)",
            new { p.Id, p.Title, p.Industry, Tags = p.Tags, p.Problem, p.Solution, p.TechStack, p.Outcomes, p.Links });
        return p;
    }

    public async Task DeleteProject(Guid id)
    {
        await using var conn = await Connect();
        await conn.ExecuteAsync("DELETE FROM projects WHERE id = @id", new { id });
    }

    public async Task UpdateProjectEmbedding(Guid id, float[] embedding)
    {
        await using var conn = await Connect();
        var vec = "[" + string.Join(",", embedding) + "]";
        await conn.ExecuteAsync("UPDATE projects SET embedding = @vec::vector WHERE id = @id", new { vec, id });
    }

    public async Task<List<Project>> SearchSimilarProjects(float[] queryEmbedding, int limit = 3)
    {
        await using var conn = await Connect();
        var vec = "[" + string.Join(",", queryEmbedding) + "]";
        var rows = await conn.QueryAsync<dynamic>(
            "SELECT id,title,industry,problem,solution,tech_stack,outcomes,tags FROM projects WHERE embedding IS NOT NULL ORDER BY embedding <=> @vec::vector LIMIT @limit",
            new { vec, limit });
        return rows.Select(r => new Project
        {
            Id = r.id, Title = r.title ?? "", Industry = r.industry ?? "",
            Tags = (r.tags as string[]) ?? [], Problem = r.problem ?? "",
            Solution = r.solution ?? "", TechStack = r.tech_stack ?? "", Outcomes = r.outcomes ?? "",
        }).ToList();
    }

    public async Task<List<Lead>> GetLeads()
    {
        await using var conn = await Connect();
        var rows = await conn.QueryAsync<dynamic>(
            "SELECT id,name,title,company,industry,location,emails,phones,linkedin_url,saved_at FROM leads ORDER BY saved_at DESC");
        return rows.Select(MapLead).ToList();
    }

    public async Task<Lead?> GetLeadById(Guid id)
    {
        await using var conn = await Connect();
        var r = await conn.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT id,name,title,company,industry,location,emails,phones,linkedin_url FROM leads WHERE id=@id", new { id });
        return r == null ? null : MapLead(r);
    }

    public async Task<Lead> InsertLead(Lead l)
    {
        await using var conn = await Connect();
        await conn.ExecuteAsync(
            "INSERT INTO leads (id,name,title,company,industry,location,emails,phones,linkedin_url) VALUES (@Id,@Name,@Title,@Company,@Industry,@Location,@Emails,@Phones,@LinkedinUrl) ON CONFLICT (id) DO NOTHING",
            new { l.Id, l.Name, l.Title, l.Company, l.Industry, l.Location, l.Emails, l.Phones, l.LinkedinUrl });
        return l;
    }

    public async Task UpdateLeadPhones(Guid id, string[] phones)
    {
        await using var conn = await Connect();
        await conn.ExecuteAsync("UPDATE leads SET phones=@phones WHERE id=@id", new { phones, id });
    }

    public async Task DeleteLead(Guid id)
    {
        await using var conn = await Connect();
        await conn.ExecuteAsync("DELETE FROM leads WHERE id=@id", new { id });
    }

    public async Task<List<OutreachRecord>> GetOutreachHistory()
    {
        await using var conn = await Connect();
        var rows = await conn.QueryAsync<dynamic>(
            "SELECT id,lead_id,lead_name,channel,subject,body,status,sent_at FROM outreach ORDER BY sent_at DESC");
        return rows.Select(r => new OutreachRecord
        {
            Id = r.id, LeadId = r.lead_id, LeadName = r.lead_name ?? "",
            Channel = r.channel ?? "", Subject = r.subject, Body = r.body ?? "",
            Status = r.status ?? "", SentAt = r.sent_at,
        }).ToList();
    }

    public async Task<OutreachRecord> InsertOutreach(OutreachRecord o)
    {
        await using var conn = await Connect();
        await conn.ExecuteAsync(
            "INSERT INTO outreach (id,lead_id,lead_name,channel,subject,body,status) VALUES (@Id,@LeadId,@LeadName,@Channel,@Subject,@Body,@Status)",
            new { o.Id, o.LeadId, o.LeadName, o.Channel, o.Subject, o.Body, o.Status });
        return o;
    }

    private static Lead MapLead(dynamic r) => new()
    {
        Id = r.id, Name = r.name ?? "", Title = r.title ?? "", Company = r.company ?? "",
        Industry = r.industry ?? "", Location = r.location ?? "",
        Emails = (r.emails as string[]) ?? [],
        Phones = (r.phones as string[]) ?? [],
        LinkedinUrl = r.linkedin_url,
        SavedAt = r.saved_at,
    };
}
