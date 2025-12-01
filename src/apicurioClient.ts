type AuthHeaders = {
  Authorization?: string;
};

export type ApicurioClientOptions = {
  baseUrl: string;
  groupId: string;
  token?: string;
  username?: string;
  password?: string;
};

export type CompatibilityLevel = "BACKWARD" | "FORWARD" | "FULL";

export class ApicurioClient {
  private readonly base: string;
  constructor(private readonly opts: ApicurioClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(): AuthHeaders {
    if (this.opts.token) return { Authorization: `Bearer ${this.opts.token}` };
    if (this.opts.username && this.opts.password) {
      const creds = Buffer.from(
        `${this.opts.username}:${this.opts.password}`,
      ).toString("base64");
      return { Authorization: `Basic ${creds}` };
    }
    return {};
  }

  private async handleResponse(res: Response, context: string) {
    if (res.ok) return res;
    const message = await res.text();
    throw new Error(`${context} failed (${res.status}): ${message}`);
  }

  private async latestVersionMetadata(
    artifactId: string,
  ): Promise<{ globalId: number } | undefined> {
    const url = `${this.base}/apis/registry/v3/groups/${this.opts.groupId}/artifacts/${artifactId}/versions/branch=latest`;
    const res = await fetch(url, { headers: this.authHeaders() });
    if (res.status === 404) return undefined;
    const ok = await this.handleResponse(res, "fetch latest version metadata");
    return (await ok.json()) as { globalId: number };
  }

  async getGlobalId(artifactId: string): Promise<number> {
    const data = await this.latestVersionMetadata(artifactId);
    if (!data) throw new Error(`fetch latest version metadata failed (404): artifact ${artifactId} not found`);
    return data.globalId;
  }

  async getSchemaByGlobalId(
    globalId: number,
  ): Promise<Record<string, unknown>> {
    const url = `${this.base}/apis/registry/v3/ids/globalIds/${globalId}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...this.authHeaders(),
      },
    });
    const ok = await this.handleResponse(res, "fetch schema");
    return ok.json() as Promise<Record<string, unknown>>;
  }

  async testCompatibility(
    artifactId: string,
    schemaContent: string,
  ): Promise<void> {
    let currentSchema: Record<string, unknown> | undefined;
    const currentMeta = await this.latestVersionMetadata(artifactId);
    if (currentMeta?.globalId) {
      try {
        currentSchema = await this.getSchemaByGlobalId(currentMeta.globalId);
      } catch {
        // ignore errors when printing current schema
      }
    }

    let proposed: Record<string, unknown>;
    try {
      proposed = JSON.parse(schemaContent) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Proposed schema is not valid JSON: ${(err as Error).message}`);
    }

    if (currentSchema) {
      console.info(`[compat] Existing schema for ${artifactId}:`);
      console.info(JSON.stringify(currentSchema, null, 2));
    } else {
      console.info(`[compat] No existing schema found for ${artifactId} (new artifact)`);
    }
    console.info(`[compat] Proposed schema for ${artifactId}:`);
    console.info(JSON.stringify(proposed, null, 2));

    const url = `${this.base}/apis/registry/v3/groups/${this.opts.groupId}/artifacts?ifExists=FIND_OR_CREATE_VERSION&dryRun=true`;
    const payload = {
      artifactId,
      artifactType: "JSON",
      firstVersion: {
        content: {
          content: schemaContent,
          contentType: "application/json",
        },
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify(payload),
    });
    await this.handleResponse(res, "compatibility test (dry-run)");
  }

  async registerOrUpdateArtifact(
    artifactId: string,
    schemaContent: string,
  ): Promise<number> {
    const url = `${this.base}/apis/registry/v3/groups/${this.opts.groupId}/artifacts?ifExists=FIND_OR_CREATE_VERSION`;
    const payload = {
      artifactId,
      artifactType: "JSON",
      firstVersion: {
        content: {
          content: schemaContent,
          contentType: "application/json",
        },
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify(payload),
    });
    const ok = await this.handleResponse(res, "register/update artifact");
    const data = (await ok.json()) as { version?: { globalId?: number } };
    if (data?.version?.globalId) return data.version.globalId;
    return this.getGlobalId(artifactId);
  }

  async ensureCompatibility(
    artifactId: string,
    level: CompatibilityLevel = "FORWARD",
  ): Promise<void> {
    const ruleUrl = `${this.base}/apis/registry/v3/groups/${this.opts.groupId}/artifacts/${artifactId}/rules/COMPATIBILITY`;
    const payload = { config: level };

    const res = await fetch(ruleUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 404) {
      // create rule if doesn't exist
      const createUrl = `${this.base}/apis/registry/v3/groups/${this.opts.groupId}/artifacts/${artifactId}/rules`;
      const createPayload = {
        type: "COMPATIBILITY",
        ruleType: "COMPATIBILITY",
        config: level,
      };
      const createRes = await fetch(createUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify(createPayload),
      });
      await this.handleResponse(createRes, "create compatibility rule");
      return;
    }

    await this.handleResponse(res, "set compatibility rule");
  }
}
