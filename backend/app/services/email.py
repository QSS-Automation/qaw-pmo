"""
Invitation emails via generic SMTP. Works with any standard provider — see
config.py's SMTP_HOST comment. Every function here degrades gracefully:
if SMTP isn't configured, or sending fails for any reason (wrong password,
provider blocking the connection, network hiccup), the caller gets a clear
False/None back and logs the reason — it never raises up into the request
and blocks the invitation itself from being created. The invitation and its
link always exist in the database regardless of whether the email went out;
Admin can always fall back to copying the link manually from the
Invitations tab, exactly like before this existed.
"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.config import settings


def is_smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_FROM_EMAIL)


def send_invitation_email(to_email: str, to_name: str, invite_token: str) -> bool:
    """Returns True if the email was handed off to the SMTP server successfully."""
    if not is_smtp_configured():
        return False

    link = f"{settings.APP_BASE_URL.rstrip('/')}/accept-invite/{invite_token}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "You've been invited to QAW PM Ecosystem"
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
    msg["To"] = to_email

    text_body = (
        f"Hi {to_name},\n\n"
        f"You've been invited to QAW PM Ecosystem. Click the link below to get access:\n\n"
        f"{link}\n\n"
        f"This link is yours specifically — you can open it on any device you plan to use.\n"
    )
    html_body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <p>Hi {to_name},</p>
      <p>You've been invited to <strong>QAW PM Ecosystem</strong>.</p>
      <p style="margin: 24px 0;">
        <a href="{link}" style="background:#0F6E56;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
          Accept invitation
        </a>
      </p>
      <p style="color:#888;font-size:12px;">This link is yours specifically — you can open it on any device you plan to use.</p>
    </div>
    """
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM_EMAIL, [to_email], msg.as_string())
        return True
    except Exception as e:
        print(f"[email] Failed to send invitation to {to_email} (non-fatal, invite still created): {e}")
        return False
