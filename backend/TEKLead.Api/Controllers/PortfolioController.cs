using Microsoft.AspNetCore.Mvc;
using TEKLead.Api.Models;
using TEKLead.Api.Services;

namespace TEKLead.Api.Controllers;

[ApiController]
[Route("api/portfolio")]
public class PortfolioController : ControllerBase
{
    private readonly DbService _db;
    private readonly EmailAiService _ai;

    public PortfolioController(DbService db, EmailAiService ai) { _db = db; _ai = ai; }

    [HttpGet]
    public async Task<IActionResult> GetAll() => Ok(await _db.GetProjects());

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] Project project)
    {
        project.Id = Guid.NewGuid();
        project.CreatedAt = DateTime.UtcNow;
        var result = await _db.InsertProject(project);

        // Generate and store embedding async (don't block response)
        _ = Task.Run(async () =>
        {
            try
            {
                var text = $"{project.Title} {project.Industry} {project.Problem} {project.Solution} {project.Outcomes}";
                var embedding = await _ai.GetEmbedding(text);
                await _db.UpdateProjectEmbedding(project.Id, embedding);
            }
            catch { }
        });

        return Ok(result);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        await _db.DeleteProject(id);
        return Ok();
    }
}
