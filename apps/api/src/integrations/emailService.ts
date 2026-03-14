// apps/api/src/integrations/emailService.ts

import { Resend } from "resend";

console.log("[emailService] resend configured:", Boolean(process.env.RESEND_API_KEY));
console.log("[emailService] EMAIL_FROM:", process.env.EMAIL_FROM);

type OrgInviteEmailParams = {
  to: string;
  inviteLink: string;
  orgName?: string;
  invitedByName?: string;
  orgRole?: "Member" | "OrgAdmin";
  expiresAt?: string | Date;
};

type DocumentInviteEmailParams = {
  to: string;
  inviterName: string;
  documentTitle: string;
  documentLink: string;
  message?: string;
};

const resend =
  process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 0
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

const FROM =
  process.env.EMAIL_FROM && process.env.EMAIL_FROM.trim().length > 0
    ? process.env.EMAIL_FROM
    : "noreply@localhost";

/**
 * Internal send function.
 * Uses Resend if configured.
 * Falls back to console logging in dev.
 */
async function sendEmail(params: { to: string; subject: string; html: string }) {
  const to = (params.to ?? "").trim();

  console.log("[emailService] sendEmail called:", { to, subject: params.subject });

  if (!to || !to.includes("@")) {
    const err = new Error(`Invalid recipient email: "${params.to}"`);
    console.error("[emailService] invalid recipient", err.message);
    throw err;
  }

  if (!resend) {
    console.log("==== EMAIL (DEV FALLBACK) ====");
    console.log("From:", FROM);
    console.log("To:", to);
    console.log("Subject:", params.subject);
    console.log("HTML:", params.html);
    console.log("================================");
    return;
  }

  try {
    const out = await resend.emails.send({
      from: FROM,
      to,
      subject: params.subject,
      html: params.html,
    });

    console.log("[emailService] resend response:", out);
  } catch (e: any) {
    console.error("[emailService] resend send failed:", e?.message ?? e);
    if (e?.response) console.error("[emailService] resend response:", e.response);
    if (e?.data) console.error("[emailService] resend data:", e.data);
    throw e;
  }
}

function formatExpiry(value?: string | Date) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const emailService = {
  /**
   * ORG INVITE EMAIL
   */
  async sendOrgInvite(params: OrgInviteEmailParams) {
    const subject = `You're invited to join ${params.orgName ?? "an organization"}`;

    const roleLabel = params.orgRole ?? "Member";
    const expiresLabel = formatExpiry(params.expiresAt);

    const html = `
      <div style="font-family: ui-sans-serif, system-ui; line-height:1.5; color:#111;">
        <h2 style="margin-bottom:12px;">Organization Invite</h2>

        <p>You have been invited to join ${params.orgName ?? "an organization"}.</p>

        ${params.orgName ? `<p><strong>Organization:</strong> ${params.orgName}</p>` : ""}
        ${params.invitedByName ? `<p><strong>Invited by:</strong> ${params.invitedByName}</p>` : ""}
        <p><strong>Role:</strong> ${roleLabel}</p>
        ${expiresLabel ? `<p><strong>Expires:</strong> ${expiresLabel}</p>` : ""}

        <p style="margin-top:16px;">
          Click the button below to accept the invite and complete your account setup.
        </p>

        <p style="margin-top:16px;">
          <a href="${params.inviteLink}"
             style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111;color:#fff;text-decoration:none;">
            Accept Invite
          </a>
        </p>

        <p style="margin-top:16px;font-size:12px;color:#666;">
          If the button does not work, copy and paste this link into your browser:
        </p>
        <p style="font-size:12px;color:#666;word-break:break-all;">
          ${params.inviteLink}
        </p>

        <p style="color:#666;font-size:12px;margin-top:16px;">
          If you didn't expect this invite, you can ignore this email.
        </p>
      </div>
    `;

    await sendEmail({ to: params.to, subject, html });
  },

  /**
   * DOCUMENT INVITE EMAIL
   */
  async sendDocumentInvite(params: DocumentInviteEmailParams) {
    const subject = `${params.inviterName} invited you to collaborate`;

    const message =
      params.message && params.message.trim().length > 0 ? params.message.trim() : "";

    const html = `
      <div style="font-family: ui-sans-serif, system-ui; line-height:1.5">
        <h2>Document Invitation</h2>
        <p><strong>Invited by:</strong> ${params.inviterName}</p>
        <p><strong>Document:</strong> ${params.documentTitle}</p>

        ${message ? `<p style="margin-top:12px;"><em>${message}</em></p>` : ""}

        <p style="margin-top:16px;">
          <a href="${params.documentLink}"
             style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111;color:#fff;text-decoration:none;">
            Open Invite
          </a>
        </p>

        <p style="color:#666;font-size:12px;margin-top:16px;">
          If you weren't expecting this invite, you can safely ignore this email.
        </p>
      </div>
    `;

    await sendEmail({ to: params.to, subject, html });
  },
};