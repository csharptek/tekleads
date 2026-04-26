using System.Diagnostics;
using System.Text.Json;
using TEKLead.Api.Models;

namespace TEKLead.Api.Services;

public class ProposalExportService
{
    private readonly SettingsService _settings;
    private readonly ProposalService _proposals;
    private readonly ILogger<ProposalExportService> _log;

    public ProposalExportService(SettingsService settings, ProposalService proposals, ILogger<ProposalExportService> log)
    {
        _settings = settings;
        _proposals = proposals;
        _log = log;
    }

    public async Task<(byte[] Bytes, string FileName)> ExportWord(Guid proposalId)
    {
        var proposal = await _proposals.GetById(proposalId);
        if (proposal == null)
            throw new Exception("Proposal not found.");

        if (string.IsNullOrWhiteSpace(proposal.GeneratedResponse))
            throw new Exception("No generated proposal content. Generate the proposal first.");

        // Load proposal settings
        var allSettings = await _settings.GetAll();
        var proposalSettings = new
        {
            companyName          = allSettings.GetValueOrDefault("proposal_company_name", "CSharpTek"),
            signerName           = allSettings.GetValueOrDefault("proposal_signer_name", "Bhanu"),
            signerTitle          = allSettings.GetValueOrDefault("proposal_signer_title", "Lead Developer & Project Manager"),
            website              = allSettings.GetValueOrDefault("proposal_website", ""),
            confidentialityText  = allSettings.GetValueOrDefault("proposal_confidentiality_text", "This document is intended solely for the recipient and may not be shared without written consent."),
            footerText           = allSettings.GetValueOrDefault("proposal_footer_text", "Confidential"),
        };

        var proposalData = new
        {
            clientName           = proposal.ClientName,
            clientCompany        = proposal.ClientCompany,
            clientCountry        = proposal.ClientCountry,
            clientCity           = proposal.ClientCity,
            jobPostHeadline      = proposal.JobPostHeadline,
            jobPostBody          = proposal.JobPostBody,
            budgetMin            = proposal.BudgetMin,
            budgetMax            = proposal.BudgetMax,
            timelineValue        = proposal.TimelineValue,
            timelineUnit         = proposal.TimelineUnit,
            generatedResponse    = proposal.GeneratedResponse,
        };

        var settingsJson  = JsonSerializer.Serialize(proposalSettings);
        var proposalJson  = JsonSerializer.Serialize(proposalData);

        // Find the export script
        var scriptPath = FindScript();
        _log.LogInformation("Export script: {0}", scriptPath);

        // Ensure docx npm package is available
        await EnsureDocxPackage(scriptPath);

        // Run Node.js script — receives binary stdout
        var psi = new ProcessStartInfo
        {
            FileName               = "node",
            ArgumentList           = { scriptPath, settingsJson, proposalJson },
            RedirectStandardOutput = true,
            RedirectStandardError  = true,
            UseShellExecute        = false,
        };

        using var proc = Process.Start(psi)!;

        // Read binary stdout
        using var ms = new MemoryStream();
        await proc.StandardOutput.BaseStream.CopyToAsync(ms);
        var stderr = await proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();

        if (proc.ExitCode != 0 || ms.Length == 0)
        {
            _log.LogError("Node export failed (exit {0}): {1}", proc.ExitCode, stderr);
            throw new Exception($"Word export failed: {stderr.Trim().Split('\n').LastOrDefault()}");
        }

        var clientSuffix = string.IsNullOrWhiteSpace(proposal.ClientCompany)
            ? proposal.ClientName
            : proposal.ClientCompany;
        var fileName = $"Proposal_{Sanitize(clientSuffix)}_{DateTime.UtcNow:yyyyMMdd}.docx";

        return (ms.ToArray(), fileName);
    }

    private string FindScript()
    {
        // Look relative to the assembly location
        var assemblyDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(assemblyDir, "Scripts", "proposal-export.js"),
            Path.Combine(assemblyDir, "..", "Scripts", "proposal-export.js"),
            Path.Combine(Directory.GetCurrentDirectory(), "Scripts", "proposal-export.js"),
            "/app/Scripts/proposal-export.js", // Docker path
        };

        foreach (var p in candidates)
        {
            var full = Path.GetFullPath(p);
            if (File.Exists(full)) return full;
        }

        throw new FileNotFoundException("proposal-export.js not found. Ensure Scripts/ folder is published.");
    }

    private async Task EnsureDocxPackage(string scriptPath)
    {
        var scriptDir = Path.GetDirectoryName(scriptPath)!;
        var nodeModules = Path.Combine(scriptDir, "node_modules", "docx");

        if (Directory.Exists(nodeModules)) return;

        _log.LogInformation("Installing docx npm package...");
        var psi = new ProcessStartInfo
        {
            FileName = "npm",
            ArgumentList = { "install", "docx", "--prefix", scriptDir },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        using var proc = Process.Start(psi)!;
        await proc.WaitForExitAsync();
        _log.LogInformation("docx npm install exit: {0}", proc.ExitCode);
    }

    private static string Sanitize(string? s) =>
        string.IsNullOrWhiteSpace(s) ? "Proposal" :
        new string(s.Where(c => char.IsLetterOrDigit(c) || c == '_').ToArray());
}
