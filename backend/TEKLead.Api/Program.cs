using TEKLead.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpClient();

builder.Services.AddSingleton<SettingsService>();
builder.Services.AddScoped<DbService>();
builder.Services.AddScoped<ApolloService>();
builder.Services.AddScoped<EmailAiService>();
builder.Services.AddScoped<OutreachService>();

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

var app = builder.Build();
app.UseCors();
app.MapGet("/health", () => Results.Ok("healthy"));
app.MapControllers();
app.Run();
