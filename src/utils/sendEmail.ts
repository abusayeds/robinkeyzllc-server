import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

const emailLogger = new Logger('Email');

/**
 * Sends without blocking the response. SMTP can take several seconds and the
 * OTP is already stored, so the caller must not wait for delivery.
 * A failure is logged only — the user can ask for a new OTP.
 */
export const sendInBackground = (
  send: () => Promise<unknown>,
  context: string,
): void => {
  void send()
    .then(() => emailLogger.log(`Sent ${context}`))
    .catch((error) =>
      emailLogger.error(`Failed to send ${context}`, error as Error),
    );
};

let transporter: nodemailer.Transporter | null = null;

/**
 * One pooled transporter for the whole app. Creating one per email left an
 * SMTP socket open every time, which piles up and keeps the process alive.
 */
const getTransporter = (): nodemailer.Transporter => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      secure: true,
      pool: true,
      maxConnections: 3,
      auth: {
        user: process.env.Nodemailer_GMAIL,
        pass: process.env.Nodemailer_GMAIL_PASSWORD,
      },
    });
  }
  return transporter;
};

export const closeEmailTransporter = (): void => {
  transporter?.close();
  transporter = null;
};

export const generateOTP = (): string =>
  Math.floor(100000 + Math.random() * 900000).toString();

export const sendRegistrationOtpEmail = async (otp: string, email: string) => {
  const transporter = getTransporter();

  const emailContent = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f0f0f0; padding: 20px;">
    <h1 style="text-align: center; color: #452778; font-family: 'Times New Roman', Times, serif;">
      RobinKeyz<span style="color:black; font-size: 0.9em;"> LLC</span>
    </h1>
    <div style="background-color: white; padding: 20px; border-radius: 5px;">
      <h2 style="color:#d3b06c">Welcome!</h2>
      <p>Please enter this confirmation code to finish creating your account.</p>
      <div style="text-align: center; margin: 20px 0;">
        <h3>Your OTP is: <strong>${otp}</strong></h3>
      </div>
      <p>This OTP will expire in 10 minutes.</p>
      <p>If you did not create an account, please ignore this email.</p>
      <p>Regards,<br>RobinKeyz LLC Team</p>
    </div>
  </div>`;

  await transporter.sendMail({
    from: process.env.Nodemailer_GMAIL,
    to: email,
    subject: 'Verify your email',
    html: emailContent,
  });
};

export const sendForgotPasswordOtpEmail = async (
  otp: string,
  email: string,
) => {
  const transporter = getTransporter();

  const emailContent = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f0f0f0; padding: 20px;">
    <h1 style="text-align: center; color: #452778; font-family: 'Times New Roman', Times, serif;">
      RobinKeyz<span style="color:black; font-size: 0.9em;"> LLC</span>
    </h1>
    <div style="background-color: white; padding: 20px; border-radius: 5px;">
      <h2 style="color:#d3b06c">Hello Dear!</h2>
      <p>You are receiving this email because we received a password reset request for your account.</p>
      <div style="text-align: center; margin: 20px 0;">
        <h3>Your OTP is: <strong>${otp}</strong></h3>
      </div>
      <p>This OTP will expire in 10 minutes.</p>
      <p>If you did not request a password reset, no further action is required.</p>
      <p>Regards,<br>RobinKeyz LLC Team</p>
    </div>
  </div>`;

  await transporter.sendMail({
    from: process.env.Nodemailer_GMAIL,
    to: email,
    subject: 'Reset Password OTP',
    html: emailContent,
  });
};
