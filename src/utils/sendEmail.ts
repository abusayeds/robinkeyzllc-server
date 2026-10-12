import * as nodemailer from 'nodemailer';

const createTransporter = () =>
  nodemailer.createTransport({
    service: 'gmail',
    secure: true,
    auth: {
      user: process.env.Nodemailer_GMAIL,
      pass: process.env.Nodemailer_GMAIL_PASSWORD,
    },
  });

export const generateOTP = (): string =>
  Math.floor(100000 + Math.random() * 900000).toString();

export const sendForgotPasswordOtpEmail = async (
  otp: string,
  email: string,
) => {
  const transporter = createTransporter();

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
