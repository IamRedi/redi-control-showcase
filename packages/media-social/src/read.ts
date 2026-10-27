import { randomUUID } from "node:crypto";

import { withTenant, type DatabasePool } from "@redi-control/database";

import type {
  MetaReadOnlyOAuthAdapter,
  OAuthTokenSet,
  TokenSecretProvider,
} from "./oauth.js";

export interface SocialReadMetric {
  readonly key: string;
  readonly value: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly providerReportedAt?: string;
}

/**
 * Pulls only date-bounded aggregate counters. It intentionally has no method
 * for messages, publishing, comments' text, replies, likes or webhooks.
 */
export class MetaReadOnlyCollectionService {
  public constructor(
    private readonly pool: DatabasePool,
    private readonly secrets: TokenSecretProvider,
    private readonly meta: MetaReadOnlyOAuthAdapter,
  ) {}

  public async collect(input: {
    tenantId: string;
    workspaceId: string;
    actorUserId: string;
    correlationId: string;
  }): Promise<{
    readonly collectedAccounts: number;
    readonly metricCount: number;
  }> {
    const accounts = await withTenant(
      this.pool,
      input.tenantId,
      async (client) => {
        const result = await client.query<{
          id: string;
          account_type: "facebook_page" | "instagram_account";
          provider_account_id: string;
          token_reference: string;
        }>(
          `SELECT id,account_type,provider_account_id,token_reference
         FROM control.social_accounts
         WHERE workspace_id=$1 AND provider='meta' AND status='active'
         ORDER BY created_at,id`,
          [input.workspaceId],
        );
        return result.rows;
      },
    );
    let metricCount = 0;
    for (const account of accounts) {
      const token = JSON.parse(
        await this.secrets.resolve(account.token_reference, {
          tenantId: input.tenantId,
          connectionId: account.id,
        }),
      ) as OAuthTokenSet;
      const metrics = await this.meta.readMetrics({
        providerAccountId: account.provider_account_id,
        accountType: account.account_type,
        accessToken: token.accessToken,
      });
      await withTenant(this.pool, input.tenantId, async (client) => {
        for (const metric of metrics) {
          await client.query(
            `INSERT INTO control.social_metric_observations
             (id,tenant_id,workspace_id,account_id,metric_key,period_start,period_end,value,provider_reported_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (tenant_id,account_id,metric_key,period_start,period_end)
             DO UPDATE SET value=EXCLUDED.value,provider_reported_at=EXCLUDED.provider_reported_at,collected_at=now()`,
            [
              randomUUID(),
              input.tenantId,
              input.workspaceId,
              account.id,
              metric.key,
              metric.periodStart,
              metric.periodEnd,
              metric.value,
              metric.providerReportedAt ?? null,
            ],
          );
        }
        await client.query(
          `UPDATE control.social_accounts
           SET last_synced_at=now(),health_status='healthy',updated_at=now()
           WHERE id=$1`,
          [account.id],
        );
      });
      metricCount += metrics.length;
    }
    return { collectedAccounts: accounts.length, metricCount };
  }
}
