import { Controller, Get, Res } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot(@Res() res) {
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>API Server</title>

        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          }

          body {
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: #fff;
          }

          .card {
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 16px;
            text-align: center;
            backdrop-filter: blur(10px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            width: 100%;
            max-width: 420px;
          }

          h1 {
            font-size: 28px;
            margin-bottom: 12px;
          }

          p {
            font-size: 16px;
            opacity: 0.9;
            margin-bottom: 20px;
          }

          .status {
            display: inline-block;
            padding: 8px 16px;
            background: #22c55e;
            color: #0f172a;
            font-weight: 600;
            border-radius: 999px;
            font-size: 14px;
          }

          footer {
            margin-top: 25px;
            font-size: 13px;
            opacity: 0.8;
          }
        </style>
      </head>

      <body>
        <div class="card">
          <h1>🚀 API Server Running</h1>
          <p>Your NestJS backend is up and running successfully.</p>
          <span class="status">Status: OK</span>

          <footer>
            © ${new Date().getFullYear()} Backend Service
          </footer>
        </div>
      </body>
      </html>
    `);
  }
}
