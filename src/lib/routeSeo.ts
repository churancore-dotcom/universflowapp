export const SITE_ORIGIN = "https://universflow.in";

export const SOCIAL_IMAGE =
  "https://storage.googleapis.com/gpt-engineer-file-uploads/s8DT7gYYLcVOTZXqNcZ7CA0DHkg2/social-images/social-1778415482112-Screenshot_2026-05-08_185337-modified.webp";

interface RouteSeoInput {
  title: string;
  description: string;
  path: string;
  type?: string;
  /** ISO date (YYYY-MM-DD) — emits Article JSON-LD when provided */
  datePublished?: string;
  dateModified?: string;
  author?: string;
}

/**
 * Builds per-route head() meta + canonical so each page ships unique
 * title/description/og/twitter tags in the initial HTML.
 */
export function routeSeo({
  title,
  description,
  path,
  type = "website",
  datePublished,
  dateModified,
  author = "Universflow Editorial",
}: RouteSeoInput) {
  const url = `${SITE_ORIGIN}${path}`;
  const scripts = datePublished
    ? [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: title,
            description,
            datePublished,
            dateModified: dateModified ?? datePublished,
            author: { "@type": "Organization", name: author },
            publisher: {
              "@type": "Organization",
              name: "Universflow",
              url: SITE_ORIGIN,
            },
            image: SOCIAL_IMAGE,
            mainEntityOfPage: { "@type": "WebPage", "@id": url },
            url,
          }),
        },
      ]
    : undefined;

  return {
    meta: [
      { title },
      { name: "title", content: title },
      { name: "description", content: description },
      { property: "og:type", content: type },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:image", content: SOCIAL_IMAGE },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:url", content: url },
      { name: "twitter:image", content: SOCIAL_IMAGE },
    ],
    links: [{ rel: "canonical", href: url }],
    ...(scripts ? { scripts } : {}),
  };
}


export const FAQ_SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    { "@type": "Question", name: "Is Universflow really free?", acceptedAnswer: { "@type": "Answer", text: "Yes. Universflow is free to use with optional Premium upgrades. Create an account with email to start listening instantly." } },
    { "@type": "Question", name: "Can I download songs to listen offline?", acceptedAnswer: { "@type": "Answer", text: "Yes. Tap the download icon on any song or playlist and it will be saved for offline playback inside the app." } },
    { "@type": "Question", name: "Does Universflow work on Android and iPhone?", acceptedAnswer: { "@type": "Answer", text: "Universflow works in any modern browser and ships as a native Android app. iPhone users can install it as a home-screen web app." } },
    { "@type": "Question", name: "How do I create a Universflow account?", acceptedAnswer: { "@type": "Answer", text: "Visit the Universflow sign-up page, enter your email and password, verify your email, and start listening." } },
  ],
});

const APK_URL = `${SITE_ORIGIN}/api/public/apk`;

export const APP_SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "MobileApplication",
      name: "Universflow",
      operatingSystem: "ANDROID",
      applicationCategory: "MusicApplication",
      url: `${SITE_ORIGIN}/get`,
      installUrl: APK_URL,
      downloadUrl: APK_URL,
      softwareVersion: "1.0",
      fileSize: "24MB",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.8", ratingCount: "1280" },
    },
    {
      "@type": "SoftwareApplication",
      name: "Universflow",
      operatingSystem: "Android 5.1+",
      applicationCategory: "MusicApplication",
      downloadUrl: APK_URL,
      installUrl: APK_URL,
      softwareVersion: "1.0",
      fileSize: "24MB",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.8", ratingCount: "1280" },
    },
  ],
});
