# 🚀 Deployment Guide

## Quick Start for Local Development

### Option 1: Using npm (Recommended)

1. **Install dependencies:**
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

2. **Configure environment:**
```bash
cd backend
cp .env.example .env
# Edit .env and add your Google private key
```

3. **Run the application:**

Open two terminal windows:

**Terminal 1 (Backend):**
```bash
cd backend
npm start
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm start
```

4. **Access the app:**
Open your browser to `http://localhost:3000`

---

## Production Deployment

### Option 1: Deploy to Heroku

#### Backend Deployment

1. **Create a Heroku app:**
```bash
cd backend
heroku create your-app-name-backend
```

2. **Set environment variables:**
```bash
heroku config:set GOOGLE_PRIVATE_KEY="your-private-key-here"
```

3. **Deploy:**
```bash
git init
git add .
git commit -m "Initial commit"
git push heroku main
```

#### Frontend Deployment

1. **Update API URL in frontend:**
Edit `frontend/package.json` and change the proxy to your Heroku backend URL:
```json
"proxy": "https://your-app-name-backend.herokuapp.com"
```

2. **Build and deploy:**
```bash
cd frontend
npm run build
# Deploy the build folder to your hosting service
```

### Option 2: Deploy to Railway.app

1. **Install Railway CLI:**
```bash
npm install -g @railway/cli
```

2. **Login to Railway:**
```bash
railway login
```

3. **Deploy backend:**
```bash
cd backend
railway init
railway up
railway variables set GOOGLE_PRIVATE_KEY="your-key-here"
```

4. **Deploy frontend:**
```bash
cd ../frontend
railway init
railway up
```

### Option 3: Deploy to Vercel (Frontend) + Render (Backend)

#### Backend on Render

1. Create a new Web Service on Render
2. Connect your Git repository
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Add environment variable: `GOOGLE_PRIVATE_KEY`

#### Frontend on Vercel

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Deploy:
```bash
cd frontend
vercel
```

3. Update the API URL to point to your Render backend

### Option 4: Deploy to VPS (Ubuntu)

#### Prerequisites
- Ubuntu 20.04+ server
- Domain name (optional)
- SSH access

#### Installation Steps

1. **Connect to your server:**
```bash
ssh user@your-server-ip
```

2. **Install Node.js:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

3. **Install PM2:**
```bash
sudo npm install -g pm2
```

4. **Clone your repository:**
```bash
git clone <your-repo-url>
cd invoice-payment-app
```

5. **Setup backend:**
```bash
cd backend
npm install
# Create .env file with your credentials
nano .env
```

6. **Start backend with PM2:**
```bash
pm2 start server.js --name invoice-backend
pm2 save
pm2 startup
```

7. **Setup frontend:**
```bash
cd ../frontend
npm install
npm run build
```

8. **Install and configure Nginx:**
```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/invoice-app
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /path/to/invoice-payment-app/frontend/build;
        try_files $uri /index.html;
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

9. **Enable the site:**
```bash
sudo ln -s /etc/nginx/sites-available/invoice-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

10. **Setup SSL (optional but recommended):**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## Environment Variables

### Required Variables

**Backend (.env):**
```
PORT=5000
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Getting Your Google Private Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Navigate to "IAM & Admin" > "Service Accounts"
4. Click on your service account
5. Go to "Keys" tab
6. Click "Add Key" > "Create new key" > JSON
7. Download the file and copy the `private_key` field

---

## Post-Deployment Checklist

- [ ] Backend is running and accessible
- [ ] Frontend is served correctly
- [ ] Environment variables are set
- [ ] Google Sheets API access is working
- [ ] Service account has access to the spreadsheet
- [ ] Date filters work correctly
- [ ] Invoice upload and processing work
- [ ] CSV download functions properly
- [ ] SSL/HTTPS is enabled (for production)
- [ ] Error logging is configured
- [ ] Backups are scheduled (if applicable)

---

## Monitoring

### Using PM2 (VPS)

```bash
# View logs
pm2 logs invoice-backend

# Monitor resources
pm2 monit

# Restart app
pm2 restart invoice-backend

# Stop app
pm2 stop invoice-backend
```

### Check Application Health

```bash
# Check if backend is responding
curl http://localhost:5000/api/transactions

# Check if frontend is built
ls frontend/build
```

---

## Troubleshooting Deployment

### Backend won't start
- Check if port 5000 is available: `lsof -i :5000`
- Verify environment variables are set: `printenv | grep GOOGLE`
- Check logs: `pm2 logs` or `heroku logs --tail`

### Frontend shows blank page
- Check browser console for errors
- Verify API proxy is configured correctly
- Ensure backend is running and accessible
- Check that build was successful: `ls frontend/build`

### Google Sheets connection fails
- Verify service account email has access to the sheet
- Check that private key is properly formatted (includes \n for newlines)
- Confirm Sheet ID is correct in server.js

### CORS errors
- Ensure backend has CORS enabled (already configured)
- Check that frontend proxy is pointing to correct backend URL

---

## Backup and Restore

### Backup
```bash
# Backup environment variables
cp backend/.env backend/.env.backup

# Backup processed payments (if stored)
# Add backup commands for any local data
```

### Restore
```bash
# Restore environment
cp backend/.env.backup backend/.env

# Restart services
pm2 restart all
```

---

## Security Best Practices

1. **Never commit `.env` files**
2. **Use HTTPS in production**
3. **Keep dependencies updated:** `npm audit fix`
4. **Limit service account permissions** to read-only
5. **Use strong passwords** for server access
6. **Enable firewall:** `sudo ufw enable`
7. **Regular backups** of configuration
8. **Monitor logs** for suspicious activity

---

## Support

If you encounter issues during deployment:

1. Check the logs first
2. Verify all environment variables
3. Ensure all dependencies are installed
4. Check network connectivity
5. Review the troubleshooting section

For specific deployment platform documentation:
- [Heroku Docs](https://devcenter.heroku.com/)
- [Railway Docs](https://docs.railway.app/)
- [Vercel Docs](https://vercel.com/docs)
- [Render Docs](https://render.com/docs)
