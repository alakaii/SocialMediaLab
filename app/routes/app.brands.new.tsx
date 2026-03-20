import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, Form } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, TextField, Button, Select, FormLayout, Banner } from "@shopify/polaris";
import { useState } from "react";
import shopify from "../shopify.server.js";
import { createBrand } from "../services/brand.server.js";
import { COMMON_TIMEZONES } from "../utils/dateTime.js";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const formData = await request.formData();

  const name = (formData.get("name") as string).trim();
  const logoUrl = (formData.get("logoUrl") as string).trim() || undefined;
  const timezone = (formData.get("timezone") as string) || "UTC";

  if (!name) return json({ error: "Brand name is required." });

  const brand = await createBrand(session.shop, { name, logoUrl, timezone });
  return redirect(`/app/brands/${brand.id}`);
};

export default function NewBrand() {
  const actionData = useActionData<typeof action>();
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [timezone, setTimezone] = useState("UTC");

  return (
    <Page title="New Brand" backAction={{ content: "Brands", url: "/app/brands" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <Form method="post">
              <FormLayout>
                {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}
                <TextField
                  label="Brand name"
                  name="name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                  placeholder="Acme Co."
                />
                <TextField
                  label="Logo URL (optional)"
                  name="logoUrl"
                  value={logoUrl}
                  onChange={setLogoUrl}
                  autoComplete="off"
                  placeholder="https://..."
                />
                <Select
                  label="Default timezone"
                  name="timezone"
                  options={COMMON_TIMEZONES.map((tz) => ({ label: tz, value: tz }))}
                  value={timezone}
                  onChange={setTimezone}
                />
                <Button variant="primary" submit>Create Brand</Button>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
