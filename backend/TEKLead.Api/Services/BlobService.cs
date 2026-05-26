using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Dapper;
using Npgsql;

namespace TEKLead.Api.Services;

public class BlobService
{
    private readonly SettingsService _settings;
    private readonly ILogger<BlobService> _log;
    private const string Container = "proposal-docs";
    private const string DefaultWaContainer = "whatsapp-media";

    public BlobService(SettingsService settings, ILogger<BlobService> log)
    {
        _settings = settings;
        _log = log;
    }

    private async Task<BlobContainerClient> GetContainerAsync(string containerName = Container)
    {
        var all = await _settings.GetAll();
        var connStr = all.GetValueOrDefault(TEKLead.Api.Models.SettingKeys.AzureBlobConnString, "");
        if (string.IsNullOrWhiteSpace(connStr))
            throw new InvalidOperationException("Azure Blob connection string not configured in Settings.");

        var serviceClient = new BlobServiceClient(connStr);
        var container = serviceClient.GetBlobContainerClient(containerName);
        var accessType = containerName == Container ? PublicAccessType.None : PublicAccessType.Blob;
        await container.CreateIfNotExistsAsync(accessType);
        return container;
    }

    private async Task<string> GetWaContainerName()
    {
        var all = await _settings.GetAll();
        var name = all.GetValueOrDefault(TEKLead.Api.Models.SettingKeys.WhatsappBlobContainer, "");
        return string.IsNullOrWhiteSpace(name) ? DefaultWaContainer : name;
    }

    public async Task<string> UploadAsync(Stream data, string fileName, string contentType)
    {
        var container = await GetContainerAsync();
        var blobName = $"{Guid.NewGuid()}/{fileName}";
        var blob = container.GetBlobClient(blobName);
        await blob.UploadAsync(data, new BlobHttpHeaders { ContentType = contentType });
        _log.LogInformation("Uploaded blob: {0}", blobName);
        return blob.Uri.ToString();
    }

    public async Task<string> UploadPublicAsync(Stream data, string fileName, string contentType)
    {
        var waContainer = await GetWaContainerName();
        var container = await GetContainerAsync(waContainer);
        var blobName = $"{Guid.NewGuid()}/{fileName}";
        var blob = container.GetBlobClient(blobName);
        await blob.UploadAsync(data, new BlobHttpHeaders { ContentType = contentType });
        _log.LogInformation("Uploaded public blob: {0}", blobName);
        return blob.Uri.ToString();
    }

    public async Task DeleteAsync(string url)
    {
        try
        {
            var container = await GetContainerAsync();
            var uri = new Uri(url);
            var blobName = string.Join("/", uri.Segments.Skip(2)); // skip /container/
            var blob = container.GetBlobClient(Uri.UnescapeDataString(blobName));
            await blob.DeleteIfExistsAsync();
            _log.LogInformation("Deleted blob: {0}", blobName);
        }
        catch (Exception ex)
        {
            _log.LogWarning("Blob delete failed: {0}", ex.Message);
        }
    }
}
