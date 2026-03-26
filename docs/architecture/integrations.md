# Future Integrations

## OpenClaw Integration

OpenClaw is the AI orchestration layer that will power intelligent intake and review.

### Where it plugs in:
1. **Intake Bot** — OpenClaw processes conversational Discord messages into structured client-request.json
2. **Client Summary** — OpenClaw generates client-summary.md from raw intake
3. **Review** — OpenClaw reads claude-brief.md + screenshots to suggest improvements
4. **Refinement** — OpenClaw makes targeted edits to generated sites based on review feedback

### Integration points (TODO):
```
apps/intake-bot/
  └── src/openclaw-adapter.ts    // TODO: OpenClaw API client for intake processing

packages/generator/
  └── src/brief-generator.ts     // claude-brief.md could be enhanced by OpenClaw

packages/review-tools/
  └── src/ai-review.ts           // TODO: Send screenshots + brief to OpenClaw for review
```

## vaen.space Integration

vaen.space is the deployment and hosting platform.

### How it ingests deployment-payload.json:
1. Generator produces deployment-payload.json with site source, build config, and metadata
2. Portal (future) uploads payload to vaen.space API
3. vaen.space runs the build in an isolated environment
4. vaen.space provisions DNS, SSL, and CDN
5. Site goes live at `{client-slug}.vaen.space` or custom domain

### Integration points (TODO):
```
packages/generator/
  └── src/deployment-payload.ts   // Produces the payload

apps/portal/
  └── src/deploy.ts               // TODO: vaen.space API client

apps/worker/
  └── src/builder.ts              // TODO: Could also push to vaen.space directly
```

### deployment-payload.json contract:
```json
{
  "version": "1.0.0",
  "clientSlug": "flower-city-painting",
  "sitePath": "./site",
  "buildCommand": "pnpm build",
  "outputDir": ".next",
  "framework": "nextjs",
  "nodeVersion": "18",
  "envVars": {},
  "domain": {
    "subdomain": "flower-city-painting",
    "customDomain": null
  },
  "metadata": {
    "generatedAt": "2024-01-01T00:00:00Z",
    "templateId": "service-core",
    "templateVersion": "0.1.0"
  }
}
```

## Discord Integration

### Flow:
1. Client joins Discord server or DMs the bot
2. Intake bot guides them through questions
3. Bot collects business info, preferences, assets
4. OpenClaw processes conversation into client-request.json
5. Generator runs, produces workspace
6. Review tools capture screenshots
7. Screenshots posted back to Discord for client approval
8. On approval, deployment-payload.json sent to vaen.space

### Integration points (TODO):
```
apps/intake-bot/
  └── src/discord-client.ts       // TODO: Discord.js bot
  └── src/conversation-flow.ts    // TODO: Guided intake conversation
  └── src/asset-collector.ts      // TODO: Image/file uploads from Discord
```
