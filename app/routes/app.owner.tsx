/**
 * Owner-only operations surface. Not a merchant page: it is reachable from one
 * store (APP_OWNER_SHOP) and 404s for everyone else.
 *
 * Four jobs, all of them things that would otherwise need a deploy or a psql
 * session:
 *
 * 1. Plan handle mappings. The Partner Dashboard can grow plans this code has
 *    never heard of (private plans, promo plans), and the tier resolver logs
 *    "[billing] unmapped plan handle" when it meets one. Each of those logs is
 *    a row to add here.
 * 2. The global banner, rendered above every merchant's page from the app
 *    shell. This is the outage and maintenance channel, so it has to be
 *    editable while things are on fire.
 * 3. A read-only view of what every installed shop currently resolves to,
 *    which is where an unmapped handle shows up without reading logs.
 * 4. The usage-emission ledger. App Events have no read-back, so what the app
 *    wrote down is the only record of what it billed, and this card is how a
 *    failed or stuck emission gets noticed.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import type { BadgeProps, BannerProps } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { requireOwnerShop } from "../services/owner.server.js";
import { TIER_FULL } from "../billing.server.js";

/** The Polaris banner tones the owner may choose between. */
const BANNER_TONES = ["info", "warning", "critical", "success"] as const;

type BannerTone = NonNullable<BannerProps["tone"]>;

/**
 * Stored tones are just strings, and a hand-edited row could hold anything.
 * Anything unrecognized renders as "info" rather than crashing the page.
 */
function normalizeTone(tone: string): BannerTone {
  return (BANNER_TONES as readonly string[]).includes(tone)
    ? (tone as BannerTone)
    : "info";
}

/** Same instant, same string, on the server and after hydration. */
const UTC_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  requireOwnerShop(session.shop);

  const [mappings, banner, shops, emissions] = await Promise.all([
    prisma.planTierMapping.findMany({ orderBy: { planHandle: "asc" } }),
    // At most one row ever exists, so the first one is the singleton.
    prisma.globalBanner.findFirst(),
    prisma.shopBilling.findMany({ orderBy: { shop: "asc" } }),
    // The App Events API has no read-back, so this table is the only record of
    // what the app has billed. Newest first, capped: this is a health check, not
    // an archive.
    prisma.usageEmission.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const mappedHandles = new Set(mappings.map((mapping) => mapping.planHandle));

  return json({
    mappings: mappings.map((mapping) => ({
      id: mapping.id,
      planHandle: mapping.planHandle,
      tier: mapping.tier,
      note: mapping.note,
    })),
    banner: banner
      ? { message: banner.message, tone: banner.tone, active: banner.active }
      : null,
    shops: shops.map((row) => ({
      shop: row.shop,
      planHandle: row.planHandle,
      tier: row.tier,
      tierSource: row.tierSource,
      lastSyncOk: row.lastSyncOk,
      lastSyncAt: row.lastSyncAt ? UTC_TIME_FORMAT.format(row.lastSyncAt) : null,
      // A handle with no mapping row is a mapping waiting to be added, which is
      // the whole reason this table is on the page.
      unmapped: Boolean(row.planHandle) && !mappedHandles.has(row.planHandle!),
    })),
    emissions: emissions.map((row) => ({
      id: row.id,
      shop: row.shop,
      periodKey: row.periodKey,
      quantity: row.quantity,
      status: row.status,
      // sentAt is the billing moment and createdAt is the decision moment; for
      // every status but "sent" they are the same thing.
      at: UTC_TIME_FORMAT.format(row.sentAt ?? row.createdAt),
      detail: row.detail,
    })),
    // TIER_FULL lives in a server-only module, so the value travels through the
    // loader instead of being referenced from the component.
    suggestedTier: TIER_FULL,
  });
};

interface ActionResult {
  /** Which form answered, so an error lands in the card that caused it. */
  intent: string;
  error: string | null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Gate the action as well as the loader. The nav item is discoverability, not
  // a lock; this URL is POSTable by anyone who guesses it.
  const { session } = await shopify.authenticate.admin(request);
  requireOwnerShop(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "add-mapping") {
    const planHandle = String(formData.get("planHandle") ?? "").trim();
    const tier = String(formData.get("tier") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim();

    if (!planHandle) {
      return json<ActionResult>(
        { intent, error: "A plan handle is required." },
        { status: 400 },
      );
    }
    if (!tier) {
      return json<ActionResult>(
        { intent, error: "A tier is required." },
        { status: 400 },
      );
    }

    // Upsert, so re-adding a handle edits it instead of failing on the unique
    // constraint.
    await prisma.planTierMapping.upsert({
      where: { planHandle },
      update: { tier, note: note || null },
      create: { planHandle, tier, note: note || null },
    });
    return json<ActionResult>({ intent, error: null });
  }

  if (intent === "delete-mapping") {
    const id = String(formData.get("id") ?? "").trim();
    if (!id) {
      return json<ActionResult>(
        { intent, error: "A mapping id is required." },
        { status: 400 },
      );
    }
    // deleteMany rather than delete: a double submit should be a no-op, not a
    // 500 on a row that is already gone.
    await prisma.planTierMapping.deleteMany({ where: { id } });
    return json<ActionResult>({ intent, error: null });
  }

  if (intent === "save-banner") {
    const message = String(formData.get("message") ?? "").trim();
    const tone = String(formData.get("tone") ?? "").trim();
    const activeRaw = String(formData.get("active") ?? "");
    const active = activeRaw === "true" || activeRaw === "on";

    if (active && !message) {
      return json<ActionResult>(
        { intent, error: "A banner cannot be activated without a message." },
        { status: 400 },
      );
    }
    if (!(BANNER_TONES as readonly string[]).includes(tone)) {
      return json<ActionResult>(
        { intent, error: "Pick one of the listed tones." },
        { status: 400 },
      );
    }

    const existing = await prisma.globalBanner.findFirst();
    if (existing) {
      await prisma.globalBanner.update({
        where: { id: existing.id },
        data: { message, tone, active },
      });
    } else {
      await prisma.globalBanner.create({ data: { message, tone, active } });
    }
    return json<ActionResult>({ intent, error: null });
  }

  return json<ActionResult>(
    { intent, error: "Unrecognized action." },
    { status: 400 },
  );
};

const TONE_OPTIONS = BANNER_TONES.map((tone) => ({
  label: tone.charAt(0).toUpperCase() + tone.slice(1),
  value: tone,
}));

/**
 * Badge tone per ledger status. "pending" is the loud one: it means the process
 * died between writing the row and hearing back from Shopify, so whether that
 * period was billed is genuinely unknown.
 */
function emissionTone(status: string): BadgeProps["tone"] {
  if (status === "sent") return "success";
  if (status === "failed") return "critical";
  if (status === "pending") return "warning";
  return undefined;
}

export default function Owner() {
  const { mappings, banner, shops, emissions, suggestedTier } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const [planHandle, setPlanHandle] = useState("");
  const [tier, setTier] = useState(suggestedTier);
  const [note, setNote] = useState("");

  const [message, setMessage] = useState(banner?.message ?? "");
  const [tone, setTone] = useState(normalizeTone(banner?.tone ?? "info"));
  const [active, setActive] = useState(banner?.active ?? false);

  // actionData is immutable, so dismissal lives here. Every new response is a
  // fresh object, which un-dismisses the banner for the next failure.
  const [errorDismissed, setErrorDismissed] = useState(false);
  useEffect(() => setErrorDismissed(false), [actionData]);

  // A saved mapping is already in the table below, so the form goes back to
  // empty rather than repeating it.
  useEffect(() => {
    if (actionData?.intent === "add-mapping" && !actionData.error) {
      setPlanHandle("");
      setNote("");
    }
  }, [actionData]);

  const error = actionData && !errorDismissed ? actionData.error : null;
  const mappingError =
    error && actionData?.intent !== "save-banner" ? error : null;
  const bannerError = error && actionData?.intent === "save-banner" ? error : null;

  return (
    <Page title="Owner">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Plan handle mappings
                </Text>
                <Text as="p" tone="subdued">
                  Maps a plan's internal handle (not its display name) to a
                  feature tier. Adding a row beats shipping a release when the
                  dashboard grows a plan this code has never heard of.
                </Text>
              </BlockStack>

              {mappingError && (
                <Banner tone="critical" onDismiss={() => setErrorDismissed(true)}>
                  {mappingError}
                </Banner>
              )}

              <IndexTable
                resourceName={{ singular: "mapping", plural: "mappings" }}
                itemCount={mappings.length}
                selectable={false}
                headings={[
                  { title: "Plan handle" },
                  { title: "Tier" },
                  { title: "Note" },
                  { title: "Actions", hidden: true },
                ]}
                emptyState={
                  <BlockStack gap="100" inlineAlign="center">
                    <Text as="p" tone="subdued">
                      No mappings yet.
                    </Text>
                  </BlockStack>
                }
              >
                {mappings.map((mapping, index) => (
                  <IndexTable.Row
                    id={mapping.id}
                    key={mapping.id}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">
                        {mapping.planHandle}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{mapping.tier}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {mapping.note ?? ""}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete-mapping" />
                        <input type="hidden" name="id" value={mapping.id} />
                        <Button submit variant="plain" tone="critical">
                          Delete
                        </Button>
                      </Form>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>

              <Form method="post">
                <input type="hidden" name="intent" value="add-mapping" />
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Plan handle"
                      name="planHandle"
                      value={planHandle}
                      onChange={setPlanHandle}
                      autoComplete="off"
                      placeholder="pro-annual"
                      helpText="The internal handle from the Partner Dashboard."
                    />
                    <TextField
                      label="Tier"
                      name="tier"
                      value={tier}
                      onChange={setTier}
                      autoComplete="off"
                      helpText={`Usually "${suggestedTier}", the one paid tier this app sells.`}
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Note (optional)"
                    name="note"
                    value={note}
                    onChange={setNote}
                    autoComplete="off"
                    placeholder="Private plan for the launch partners"
                  />
                  <Button submit variant="primary">
                    Save mapping
                  </Button>
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Global banner
                </Text>
                <Text as="p" tone="subdued">
                  Shown at the top of every merchant's page while it is active,
                  and not dismissible, because this is the outage and
                  maintenance channel.
                </Text>
              </BlockStack>

              {bannerError && (
                <Banner tone="critical" onDismiss={() => setErrorDismissed(true)}>
                  {bannerError}
                </Banner>
              )}

              <Form method="post">
                <input type="hidden" name="intent" value="save-banner" />
                <FormLayout>
                  <TextField
                    label="Message"
                    name="message"
                    value={message}
                    onChange={setMessage}
                    autoComplete="off"
                    multiline={3}
                    placeholder="Publishing is paused while Instagram recovers. Scheduled posts will go out once it is back."
                  />
                  <Select
                    label="Tone"
                    name="tone"
                    options={TONE_OPTIONS}
                    value={tone}
                    onChange={(value) => setTone(normalizeTone(value))}
                  />
                  <Checkbox
                    label="Active"
                    name="active"
                    value="true"
                    checked={active}
                    onChange={setActive}
                    helpText="Merchants see the banner only while this is on."
                  />
                  <Button submit variant="primary">
                    Save banner
                  </Button>
                </FormLayout>
              </Form>

              {message.trim() && (
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Preview
                  </Text>
                  <Banner tone={tone}>{message}</Banner>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Shop billing state
                </Text>
                <Text as="p" tone="subdued">
                  What each installed shop last resolved to. A handle badged
                  "unmapped" has no row in the table above, which is exactly the
                  case the tier resolver logs about.
                </Text>
              </BlockStack>

              <IndexTable
                resourceName={{ singular: "shop", plural: "shops" }}
                itemCount={shops.length}
                selectable={false}
                headings={[
                  { title: "Shop" },
                  { title: "Plan handle" },
                  { title: "Tier" },
                  { title: "Source" },
                  { title: "Last sync (UTC)" },
                ]}
                emptyState={
                  <BlockStack gap="100" inlineAlign="center">
                    <Text as="p" tone="subdued">
                      No shops have resolved a tier yet.
                    </Text>
                  </BlockStack>
                }
              >
                {shops.map((row, index) => (
                  <IndexTable.Row id={row.shop} key={row.shop} position={index}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">
                        {row.shop}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span">{row.planHandle ?? "None"}</Text>
                        {row.unmapped && <Badge tone="warning">unmapped</Badge>}
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.tier}</IndexTable.Cell>
                    <IndexTable.Cell>{row.tierSource}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" tone="subdued">
                          {row.lastSyncAt ?? "Never"}
                        </Text>
                        {row.lastSyncAt && !row.lastSyncOk && (
                          <Badge tone="critical">failed</Badge>
                        )}
                      </InlineStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Usage emissions
                </Text>
                <Text as="p" tone="subdued">
                  The 20 most recent App Events the daily sweep decided on, one
                  per shop per calendar month. The App Events API has no
                  read-back, so this is the only record that exists of what was
                  billed. "dry_run" means USAGE_BILLING_ENABLED was not "true"
                  and nothing left the server.
                </Text>
              </BlockStack>

              <IndexTable
                resourceName={{ singular: "emission", plural: "emissions" }}
                itemCount={emissions.length}
                selectable={false}
                headings={[
                  { title: "Shop" },
                  { title: "Period" },
                  { title: "Brands" },
                  { title: "Status" },
                  { title: "When (UTC)" },
                  { title: "Detail" },
                ]}
                emptyState={
                  <BlockStack gap="100" inlineAlign="center">
                    <Text as="p" tone="subdued">
                      The sweep has not recorded anything yet.
                    </Text>
                  </BlockStack>
                }
              >
                {emissions.map((row, index) => (
                  <IndexTable.Row id={row.id} key={row.id} position={index}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">
                        {row.shop}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.periodKey}</IndexTable.Cell>
                    <IndexTable.Cell>{row.quantity}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={emissionTone(row.status)}>{row.status}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" tone="subdued">
                        {row.at}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text
                        as="span"
                        tone={row.status === "failed" ? "critical" : "subdued"}
                      >
                        {row.detail ?? ""}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
