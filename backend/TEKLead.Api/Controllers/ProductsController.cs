using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/products")]
public class ProductsController : ControllerBase
{
    private readonly ProductService _products;
    private readonly ProductAIService _ai;
    private readonly ILogger<ProductsController> _log;

    public ProductsController(ProductService products, ProductAIService ai, ILogger<ProductsController> log)
    {
        _products = products;
        _ai = ai;
        _log = log;
    }

    // GET /api/products
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var list = await _products.GetAll();
        return Ok(list);
    }

    // GET /api/products/{id}
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var p = await _products.GetById(id);
        return p == null ? NotFound() : Ok(p);
    }

    // POST /api/products
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] Product product)
    {
        if (string.IsNullOrWhiteSpace(product.Name))
            return BadRequest(new { error = "Name is required." });

        product.Status = "active";
        var created = await _products.Create(product);
        return Ok(created);
    }

    // PUT /api/products/{id}
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] Product product)
    {
        var updated = await _products.Update(id, product);
        return updated == null ? NotFound() : Ok(updated);
    }

    // PATCH /api/products/{id}/status
    [HttpPatch("{id:guid}/status")]
    public async Task<IActionResult> SetStatus(Guid id, [FromBody] SetStatusRequest req)
    {
        var ok = await _products.SetStatus(id, req.Status);
        return ok ? Ok(new { success = true }) : NotFound();
    }

    // DELETE /api/products/{id}
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var ok = await _products.Delete(id);
        return ok ? Ok(new { success = true }) : NotFound();
    }

    // POST /api/products/generate
    [HttpPost("generate")]
    public async Task<IActionResult> Generate([FromBody] GenerateProductsRequest req)
    {
        if (req.Keywords == null || req.Keywords.Length == 0)
            return BadRequest(new { error = "At least one keyword is required." });

        try
        {
            var products = await _ai.GenerateProducts(req.Keywords);
            return Ok(products);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Product generation failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // POST /api/products/refine
    [HttpPost("refine")]
    public async Task<IActionResult> Refine([FromBody] RefineProductRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Prompt))
            return BadRequest(new { error = "Prompt is required." });

        try
        {
            var refined = await _ai.RefineProduct(req.Product, req.Prompt);
            return Ok(refined);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Product refinement failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

public class SetStatusRequest
{
    public string Status { get; set; } = "active";
}
