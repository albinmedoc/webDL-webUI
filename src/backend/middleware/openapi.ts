import { DOWNLOAD_JOB_STATES, USENET_JOB_STATES, WEBHOOK_EVENTS } from '../db/schema.js';

/**
 * Hand-written OpenAPI 3.1 spec for the REST surface. Lives in code (not a
 * .yaml file) so the generated event/state enums can pull straight from the
 * Drizzle schema constants — drift between docs and runtime stays impossible.
 */
export function buildOpenApiSpec(version: string): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'svtplay-dl-webui REST API',
      version,
      description: [
        'REST API for queueing downloads, managing the Usenet upload pipeline,',
        'and configuring outbound webhooks.',
        '',
        'Most write endpoints require an API key when `apiKey` is configured',
        '(via env var `API_KEY` or PUT /api/settings). Reads remain open for',
        'compatibility with the bundled web UI.',
        '',
        'Job lifecycle changes flow through Socket.IO in real time *and* via',
        'configured webhooks — pick whichever fits your integration.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'this server' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Bearer token matching the `apiKey` setting. When the setting is empty, auth is disabled.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } },
        },
        DownloadFile: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            size: { type: 'integer', format: 'int64' },
          },
        },
        DownloadJob: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string', format: 'uri' },
            status: { type: 'string', enum: [...DOWNLOAD_JOB_STATES] },
            progress: { type: 'number' },
            resolution: { type: 'integer', nullable: true },
            allEpisodes: { type: 'boolean' },
            autoPostUsenet: { type: 'boolean' },
            autoPackSeason: { type: 'boolean' },
            output: { type: 'string', nullable: true },
            error: { type: 'string', nullable: true },
            outputDir: { type: 'string', nullable: true },
            files: { type: 'array', items: { $ref: '#/components/schemas/DownloadFile' } },
            logs: { type: 'array', items: { type: 'string' } },
            startTime: { type: 'integer', nullable: true },
            endTime: { type: 'integer', nullable: true },
            createdAt: { type: 'integer' },
            updatedAt: { type: 'integer' },
          },
        },
        UsenetJobSummary: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            downloadId: { type: 'string', nullable: true },
            mediaPath: { type: 'string' },
            mediaPaths: { type: 'array', items: { type: 'string' }, nullable: true },
            releaseType: { type: 'string', enum: ['single', 'season'] },
            episodeCount: { type: 'integer', nullable: true },
            mediaSizeBytes: { type: 'integer', format: 'int64' },
            state: { type: 'string', enum: [...USENET_JOB_STATES] },
            failureState: { type: 'string', nullable: true },
            progress: { type: 'integer' },
            nzbPath: { type: 'string', nullable: true },
            error: { type: 'string', nullable: true },
            indexerResponse: { type: 'string', nullable: true },
            category: { type: 'string', nullable: true },
            logs: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'integer' },
            updatedAt: { type: 'integer' },
          },
        },
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string', format: 'uri' },
            secret: {
              type: 'string',
              description: 'HMAC-SHA256 secret. Empty = no signature header sent.',
            },
            events: {
              type: 'array',
              items: { type: 'string', enum: [...WEBHOOK_EVENTS] },
              description:
                'Subscribed events. Empty array = wildcard (subscribe to all current and future events).',
            },
            enabled: { type: 'boolean' },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
              nullable: true,
              description: 'Extra HTTP headers to send. May not override Content-Type or signature headers.',
            },
            description: { type: 'string', nullable: true },
            createdAt: { type: 'integer' },
            updatedAt: { type: 'integer' },
          },
        },
        WebhookDelivery: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            webhookId: { type: 'string', format: 'uuid' },
            event: { type: 'string' },
            payload: { type: 'object', additionalProperties: true },
            state: {
              type: 'string',
              enum: ['pending', 'delivered', 'retrying', 'failed'],
            },
            attempt: { type: 'integer' },
            statusCode: { type: 'integer', nullable: true },
            responseSnippet: { type: 'string', nullable: true },
            error: { type: 'string', nullable: true },
            nextRetryAt: { type: 'integer', nullable: true },
            deliveredAt: { type: 'integer', nullable: true },
            createdAt: { type: 'integer' },
            updatedAt: { type: 'integer' },
          },
        },
      },
    },
    paths: {
      '/api/health': {
        get: {
          summary: 'Service health check',
          description:
            'Always returns 200 when the process is alive. Used by Docker healthchecks.',
          tags: ['system'],
          responses: {
            '200': {
              description: 'Healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      timestamp: { type: 'string', format: 'date-time' },
                      uptime: { type: 'number' },
                      version: { type: 'string' },
                      usenetEnabled: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/probe': {
        get: {
          summary: 'List available qualities for an SVT Play URL',
          tags: ['downloads'],
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'uri' },
              description: 'Show or episode URL on svtplay.se',
            },
          ],
          responses: {
            '200': { description: 'Probe result (svtplay-dl raw output parsed)' },
            '400': {
              description: 'Invalid URL',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '502': {
              description: 'svtplay-dl probe failed',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/api/downloads': {
        get: {
          summary: 'List downloads (paginated)',
          tags: ['downloads'],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25 } },
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: [...DOWNLOAD_JOB_STATES] },
            },
          ],
          responses: {
            '200': {
              description: 'Paginated jobs',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      jobs: { type: 'array', items: { $ref: '#/components/schemas/DownloadJob' } },
                      total: { type: 'integer' },
                      page: { type: 'integer' },
                      pageSize: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Queue a new download',
          description:
            'Creates a download job and spawns svtplay-dl in the background. Returns the job row immediately; lifecycle updates flow via Socket.IO and any configured webhooks.',
          tags: ['downloads'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    args: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Extra svtplay-dl CLI args. Defaults to empty.',
                    },
                    options: {
                      type: 'object',
                      properties: {
                        resolution: { type: 'integer', nullable: true },
                        allEpisodes: { type: 'boolean' },
                        autoPostUsenet: { type: 'boolean' },
                        autoPackSeason: { type: 'boolean' },
                      },
                    },
                  },
                },
                examples: {
                  episode: {
                    summary: 'Single episode (n8n RSS pattern)',
                    value: { url: 'https://www.svtplay.se/video/KPwkoAN/bror/avsnitt-4' },
                  },
                  fullSeries: {
                    summary: 'Whole series with auto-pack',
                    value: {
                      url: 'https://www.svtplay.se/bror',
                      options: { allEpisodes: true, autoPackSeason: true },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Job created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { job: { $ref: '#/components/schemas/DownloadJob' } },
                  },
                },
              },
            },
            '400': {
              description: 'Validation failed',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '401': {
              description: 'Missing or invalid api key',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/api/downloads/{id}': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          summary: 'Get download job',
          tags: ['downloads'],
          responses: {
            '200': {
              description: 'Job',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { job: { $ref: '#/components/schemas/DownloadJob' } },
                  },
                },
              },
            },
            '404': { description: 'Not found' },
          },
        },
        delete: {
          summary: 'Cancel and remove a download job',
          tags: ['downloads'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'deleteFiles',
              in: 'query',
              schema: { type: 'string', enum: ['1', 'true'] },
              description: 'Also delete the on-disk output dir.',
            },
          ],
          responses: {
            '204': { description: 'Removed' },
            '404': { description: 'Not found' },
          },
        },
      },
      '/api/downloads/{id}/cancel': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        post: {
          summary: 'Cancel an active download',
          tags: ['downloads'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Cancelled' },
            '404': { description: 'Not found' },
            '409': { description: 'Cannot be cancelled (already terminal)' },
          },
        },
      },
      '/api/downloads/{id}/files/download': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          summary: 'Stream a file produced by a download',
          tags: ['downloads'],
          parameters: [
            {
              name: 'path',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Absolute path of the file (must be in the job\'s file list).',
            },
          ],
          responses: {
            '200': { description: 'File stream' },
            '403': { description: 'Path outside allowed roots' },
            '404': { description: 'Not found' },
            '410': { description: 'File no longer on disk' },
          },
        },
      },
      '/api/downloads/{id}/logs': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          summary: 'Stream raw log file for a download',
          tags: ['downloads'],
          parameters: [
            {
              name: 'download',
              in: 'query',
              schema: { type: 'string', enum: ['1'] },
              description: 'Force file download with attachment headers.',
            },
          ],
          responses: {
            '200': { description: 'Log text' },
            '404': { description: 'Not found' },
          },
        },
      },
      '/api/usenet/uploads': {
        post: {
          summary: 'Drop a media file into the Usenet upload watcher',
          description:
            'Symlinks the file into `uploadWatchDir`. The watcher picks it up and creates a Usenet job asynchronously — no job id is returned.',
          tags: ['usenet'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['mediaPath'],
                  properties: {
                    mediaPath: { type: 'string', description: 'Absolute path to the source file.' },
                    downloadId: { type: 'string', nullable: true },
                    quality: { type: 'string', nullable: true },
                    applyNaming: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '202': {
              description: 'Symlink dropped',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { accepted: { type: 'boolean' }, linkPath: { type: 'string' } },
                  },
                },
              },
            },
            '400': { description: 'Validation failed' },
            '404': { description: 'Usenet feature disabled' },
          },
        },
      },
      '/api/usenet/history': {
        get: {
          summary: 'Paginated Usenet job history',
          tags: ['usenet'],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25 } },
            { name: 'state', in: 'query', schema: { type: 'string', enum: [...USENET_JOB_STATES] } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Paginated jobs' },
            '404': { description: 'Usenet feature disabled' },
          },
        },
      },
      '/api/usenet/jobs/{id}': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          summary: 'Get Usenet job',
          tags: ['usenet'],
          responses: {
            '200': {
              description: 'Job',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UsenetJobSummary' },
                },
              },
            },
            '404': { description: 'Not found' },
          },
        },
        delete: {
          summary: 'Delete Usenet job',
          tags: ['usenet'],
          security: [{ bearerAuth: [] }],
          responses: {
            '204': { description: 'Deleted' },
            '404': { description: 'Not found' },
            '409': { description: 'Job is currently active' },
          },
        },
      },
      '/api/usenet/jobs/{id}/cancel': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        post: {
          summary: 'Cancel a Usenet job',
          tags: ['usenet'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Cancelled' },
            '404': { description: 'Not found' },
            '409': { description: 'Already terminal' },
          },
        },
      },
      '/api/usenet/jobs/{id}/retry': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        post: {
          summary: 'Retry a failed Usenet job',
          tags: ['usenet'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Retry scheduled' },
            '404': { description: 'Not found' },
            '409': { description: 'Cannot retry (not in failed state)' },
          },
        },
      },
      '/api/usenet/jobs/{id}/nzb': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          summary: 'Download the generated NZB file',
          tags: ['usenet'],
          responses: {
            '200': { description: 'NZB file' },
            '404': { description: 'Not found or NZB not yet generated' },
            '410': { description: 'NZB file removed from disk' },
          },
        },
      },
      '/api/settings': {
        get: {
          summary: 'List all runtime settings',
          tags: ['settings'],
          responses: { '200': { description: 'Settings' } },
        },
        put: {
          summary: 'Update one or more settings',
          tags: ['settings'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          responses: { '200': { description: 'Apply result' }, '400': { description: 'Bad request' } },
        },
      },
      '/api/webhooks/events': {
        get: {
          summary: 'List supported webhook event names',
          tags: ['webhooks'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Event names',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      events: { type: 'array', items: { type: 'string', enum: [...WEBHOOK_EVENTS] } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/webhooks': {
        get: {
          summary: 'List webhooks',
          tags: ['webhooks'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Webhooks',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      webhooks: { type: 'array', items: { $ref: '#/components/schemas/Webhook' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create webhook',
          tags: ['webhooks'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    secret: { type: 'string' },
                    events: {
                      type: 'array',
                      items: { type: 'string', enum: [...WEBHOOK_EVENTS] },
                    },
                    enabled: { type: 'boolean', default: true },
                    headers: { type: 'object', additionalProperties: { type: 'string' } },
                    description: { type: 'string' },
                  },
                },
                example: {
                  url: 'https://n8n.example.com/webhook/svtplay',
                  secret: 'a-shared-secret',
                  events: ['download.completed', 'usenet.done'],
                  description: 'n8n flow that refreshes Plex',
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { webhook: { $ref: '#/components/schemas/Webhook' } },
                  },
                },
              },
            },
            '400': { description: 'Bad request' },
          },
        },
      },
      '/api/webhooks/{id}': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          summary: 'Get webhook',
          tags: ['webhooks'],
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Webhook' }, '404': { description: 'Not found' } },
        },
        put: {
          summary: 'Update webhook',
          tags: ['webhooks'],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Webhook' } } },
          },
          responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
        },
        delete: {
          summary: 'Delete webhook',
          tags: ['webhooks'],
          security: [{ bearerAuth: [] }],
          responses: { '204': { description: 'Deleted' }, '404': { description: 'Not found' } },
        },
      },
      '/api/webhooks/{id}/test': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        post: {
          summary: 'Send a test payload to the webhook URL',
          description:
            'Bypasses the persistent delivery queue. One-shot, no retries. The response includes the upstream HTTP status and a snippet of the response body.',
          tags: ['webhooks'],
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'Result',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean' },
                      statusCode: { type: 'integer' },
                      error: { type: 'string' },
                      responseSnippet: { type: 'string' },
                    },
                  },
                },
              },
            },
            '404': { description: 'Not found' },
          },
        },
      },
      '/api/webhooks/{id}/deliveries': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          summary: 'List recent delivery attempts for a webhook',
          tags: ['webhooks'],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50, maximum: 200 },
            },
          ],
          responses: {
            '200': {
              description: 'Recent deliveries',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      deliveries: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/WebhookDelivery' },
                      },
                    },
                  },
                },
              },
            },
            '404': { description: 'Not found' },
          },
        },
      },
    },
    tags: [
      { name: 'system', description: 'Service-level endpoints (health, version)' },
      { name: 'downloads', description: 'svtplay-dl download lifecycle' },
      { name: 'usenet', description: 'Usenet upload pipeline' },
      { name: 'settings', description: 'Runtime configuration overrides' },
      { name: 'webhooks', description: 'Outbound event delivery (n8n etc.)' },
    ],
  };
}
