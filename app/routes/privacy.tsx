// Public, unauthenticated privacy policy page. The Shopify App Store listing
// requires a privacy policy URL; this route serves it from the production
// domain (https://socialmedialab-production.up.railway.app/privacy).

const LAST_UPDATED = "August 6, 2026";

const styles = `
  body { margin: 0; }
  .privacy { max-width: 720px; margin: 0 auto; padding: 48px 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #202223; }
  .privacy h1 { font-size: 28px; margin-bottom: 4px; }
  .privacy h2 { font-size: 20px; margin-top: 32px; }
  .privacy .updated { color: #6d7175; margin-top: 0; }
  .privacy ul { padding-left: 24px; }
`;

export default function PrivacyPolicy() {
  return (
    <div className="privacy">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <h1>Social Media Lab Privacy Policy</h1>
      <p className="updated">Last updated: {LAST_UPDATED}</p>

      <p>
        Social Media Lab ("the App") helps Shopify merchants plan, schedule,
        and publish social media posts for their store. This policy describes
        what information the App collects, how it is used, and the choices
        merchants have.
      </p>

      <h2>Information we collect</h2>
      <p>When a merchant installs the App, we collect and store:</p>
      <ul>
        <li>
          Shopify store information: the store domain, and via the Shopify
          API (with the merchant's granted permissions) product, collection,
          file, and blog content used to compose posts.
        </li>
        <li>
          Social media account connections: account identifiers, display
          names, and access tokens for the social platforms the merchant
          connects (for example Facebook, Instagram, or Bluesky). Access
          tokens are encrypted at rest with AES-256-GCM.
        </li>
        <li>
          Content the merchant creates in the App: posts, captions,
          hashtags, media, brands, and scheduling preferences.
        </li>
      </ul>
      <p>
        The App does not collect or store any personal data about the
        merchant's customers (store shoppers).
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>To schedule and publish posts to the social accounts the merchant has connected.</li>
        <li>To suggest previously used hashtags and link posts to store products.</li>
        <li>To operate, secure, and improve the App.</li>
      </ul>
      <p>
        We do not sell merchant data, use it for advertising, or share it
        with third parties except the social platforms the merchant
        explicitly connects and the infrastructure providers that host the
        App.
      </p>

      <h2>Data sharing</h2>
      <p>
        Post content and media are transmitted to the social platforms the
        merchant chooses to publish to (for example Meta or Bluesky), under
        those platforms' own terms and privacy policies. The App is hosted
        on Railway; data is stored in managed PostgreSQL and Redis services.
      </p>

      <h2>Data retention and deletion</h2>
      <ul>
        <li>
          Data is retained while the App is installed on the merchant's
          store.
        </li>
        <li>
          When the App is uninstalled, Shopify sends us a deletion request
          and all store data (brands, posts, media references, connected
          social accounts and their tokens, and settings) is permanently
          deleted.
        </li>
        <li>
          Merchants can also disconnect any social account inside the App at
          any time, which deletes its stored tokens.
        </li>
      </ul>
      <p>
        The App complies with Shopify's mandatory privacy webhooks,
        including customer data requests, customer data erasure, and shop
        data erasure.
      </p>

      <h2>Security</h2>
      <p>
        All traffic to the App is encrypted with TLS. Social platform access
        tokens are encrypted at rest. Access to production systems is
        restricted to the App's operator.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions or data requests, contact:{" "}
        <a href="mailto:andreas@metalweavegames.com">
          andreas@metalweavegames.com
        </a>
      </p>
    </div>
  );
}
