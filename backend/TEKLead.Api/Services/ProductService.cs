using Dapper;
using Npgsql;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ProductService
{
    private readonly SettingsService _settings;
    private readonly ILogger<ProductService> _log;

    public ProductService(SettingsService settings, ILogger<ProductService> log)
    {
        _settings = settings;
        _log = log;
    }

    private NpgsqlConnection Conn() => new(_settings.ConnectionString);

    public async Task<List<Product>> GetAll()
    {
        await using var c = Conn();
        await c.OpenAsync();
        var rows = await c.QueryAsync<dynamic>(
            "SELECT * FROM products ORDER BY created_at DESC");

        return rows.Select(Map).ToList();
    }

    public async Task<Product?> GetById(Guid id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var row = await c.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM products WHERE id = @id", new { id });
        return row == null ? null : Map(row);
    }

    public async Task<Product> Create(Product p)
    {
        p.Id = Guid.NewGuid();
        p.CreatedAt = DateTime.UtcNow;
        p.UpdatedAt = DateTime.UtcNow;

        await using var c = Conn();
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            INSERT INTO products (id, name, tagline, target_industry, target_role, problem_solved,
                deliverables, excludes, timeline, price, tags, product_type, status, created_at, updated_at)
            VALUES (@Id, @Name, @Tagline, @TargetIndustry, @TargetRole, @ProblemSolved,
                @Deliverables, @Excludes, @Timeline, @Price, @Tags, @ProductType, @Status, @CreatedAt, @UpdatedAt)",
            new
            {
                p.Id, p.Name, p.Tagline, p.TargetIndustry, p.TargetRole, p.ProblemSolved,
                p.Deliverables, p.Excludes, p.Timeline, p.Price, p.Tags, p.ProductType, p.Status,
                p.CreatedAt, p.UpdatedAt
            });

        return p;
    }

    public async Task<Product?> Update(Guid id, Product p)
    {
        p.UpdatedAt = DateTime.UtcNow;

        await using var c = Conn();
        await c.OpenAsync();
        var affected = await c.ExecuteAsync(@"
            UPDATE products SET
                name = @Name, tagline = @Tagline, target_industry = @TargetIndustry,
                target_role = @TargetRole, problem_solved = @ProblemSolved,
                deliverables = @Deliverables, excludes = @Excludes, timeline = @Timeline,
                price = @Price, tags = @Tags, product_type = @ProductType,
                status = @Status, updated_at = @UpdatedAt
            WHERE id = @Id",
            new
            {
                p.Name, p.Tagline, p.TargetIndustry, p.TargetRole, p.ProblemSolved,
                p.Deliverables, p.Excludes, p.Timeline, p.Price, p.Tags, p.ProductType,
                p.Status, p.UpdatedAt, Id = id
            });

        return affected > 0 ? await GetById(id) : null;
    }

    public async Task<bool> SetStatus(Guid id, string status)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var affected = await c.ExecuteAsync(
            "UPDATE products SET status = @status, updated_at = NOW() WHERE id = @id",
            new { id, status });
        return affected > 0;
    }

    public async Task<bool> Delete(Guid id)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var affected = await c.ExecuteAsync(
            "DELETE FROM products WHERE id = @id", new { id });
        return affected > 0;
    }

    private static Product Map(dynamic r) => new Product
    {
        Id             = r.id,
        Name           = r.name ?? "",
        Tagline        = r.tagline ?? "",
        TargetIndustry = r.target_industry ?? "",
        TargetRole     = r.target_role ?? "",
        ProblemSolved  = r.problem_solved ?? "",
        Deliverables   = r.deliverables ?? "",
        Excludes       = r.excludes ?? "",
        Timeline       = r.timeline ?? "",
        Price          = r.price ?? "",
        Tags           = (r.tags as string[]) ?? Array.Empty<string>(),
        ProductType    = r.product_type ?? "core",
        Status         = r.status ?? "active",
        CreatedAt      = r.created_at,
        UpdatedAt      = r.updated_at,
    };
}
