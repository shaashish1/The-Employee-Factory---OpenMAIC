# PDF Parsing System

Unified interface for multiple PDF parsing providers.

## Supported providers

### 1. unpdf (built-in)
- **Cost**: free, built-in
- **Features**: basic text extraction, image extraction
- **Requirements**: none
- **Usage**: upload PDF directly

### 2. MinerU (self-hosted)
- **Cost**: free (you deploy it)
- **Features**:
  - Advanced text extraction (preserves Markdown layout)
  - Table recognition
  - Formula extraction (LaTeX)
  - Better OCR support
  - Multiple output formats (markdown, JSON, docx, html, latex)
- **Requirements**:
  - Deploy MinerU service (Docker or source)
  - Configure server URL
- **Advantages**: data privacy, no file-size limits

## Quick start

### Deploy MinerU (optional)

```bash
# Docker deployment (recommended)
docker run -p 8888:8888 mineru/mineru:latest

# Verify
curl http://localhost:8888/health
```

### API usage

#### Using unpdf (file upload)

POST a multipart form-data request with the PDF file.

#### Using MinerU (self-hosted service)

POST a JSON body with a URL pointing to the PDF, plus the MinerU endpoint
in `x-pdf-base-url` header.

## Response format

```json
{
  "success": true,
  "text": "...extracted markdown / text...",
  "images": [{ "id": "...", "src": "data:image/png;base64,..." }]
}
```

## Configuration

See `lib/pdf/constants.ts` for the supported providers registry and
`lib/pdf/parsers/` for individual adapter implementations.
