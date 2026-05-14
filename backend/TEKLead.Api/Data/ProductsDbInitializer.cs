using Dapper;
using Npgsql;
using TEKLead.Api.Services;

namespace TEKLead.Api.Data;

public class ProductsDbInitializer
{
    private readonly SettingsService _settings;
    private readonly ILogger<ProductsDbInitializer> _log;

    public ProductsDbInitializer(SettingsService settings, ILogger<ProductsDbInitializer> log)
    {
        _settings = settings;
        _log = log;
    }

    public async Task EnsureSchema()
    {
        var cs = _settings.ConnectionString;
        if (string.IsNullOrEmpty(cs)) return;

        await using var c = new NpgsqlConnection(cs);
        await c.OpenAsync();

        await c.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS products (
                id UUID PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                tagline TEXT NOT NULL DEFAULT '',
                target_industry TEXT NOT NULL DEFAULT '',
                target_role TEXT NOT NULL DEFAULT '',
                problem_solved TEXT NOT NULL DEFAULT '',
                deliverables TEXT NOT NULL DEFAULT '',
                excludes TEXT NOT NULL DEFAULT '',
                timeline TEXT NOT NULL DEFAULT '',
                price TEXT NOT NULL DEFAULT '',
                tags TEXT[] NOT NULL DEFAULT '{}',
                product_type TEXT NOT NULL DEFAULT 'core',
                status TEXT NOT NULL DEFAULT 'active',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )");

        _log.LogInformation("products table ready.");
    }
}
