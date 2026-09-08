import { d1Db } from "../lib/d1.server";
import {
  getClientReportShareByToken,
  type ClientReportSharePublic,
} from "@/db/clientReports";
import { ClientReportDocument } from "../components/client-report";

type PublicShareContext = {
  cloudflare: { env: { DB: unknown } };
};

type LoaderArgs = {
  request: Request;
  context: PublicShareContext;
};

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function meta({ data }: { data?: ClientReportSharePublic | null }) {
  return [
    {
      title: data
        ? `${data.snapshot.client.name} report · ${data.snapshot.agency.name}`
        : "Client report",
    },
  ];
}

export function headers(_args?: unknown) {
  return NO_STORE_HEADERS;
}

/** The URL token resolves only the immutable report snapshot. */
export async function loader({ request, context }: LoaderArgs): Promise<ClientReportSharePublic> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const db = d1Db(context.cloudflare.env.DB as never);
  const share = await getClientReportShareByToken(db, token);
  if (!share) {
    throw new Response("This report link has expired or is no longer available.", {
      status: 404,
      headers: NO_STORE_HEADERS,
    });
  }
  return share;
}

export default function ClientReportShare({ loaderData }: { loaderData: ClientReportSharePublic }) {
  return (
    <main className="detail detail-narrow client-report-public-page">
      <ClientReportDocument snapshot={loaderData.snapshot} publicView />
    </main>
  );
}
