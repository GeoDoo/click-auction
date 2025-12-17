// Dynamic Ad Image Generator
// Creates unique, visually interesting ad images based on text

class AdGenerator {
  constructor(width = 800, height = 600) {
    this.width = width;
    this.height = height;
  }

  // Generate a random color palette - VIOOH brand inspired
  generatePalette() {
    const palettes = [
      // VIOOH Primary - Teal gradients
      { bg: ['#00C9A7', '#00A389'], accent: '#ffffff', text: '#ffffff' },
      { bg: ['#00C9A7', '#006B5A'], accent: '#E91E8C', text: '#ffffff' },
      { bg: ['#00D4D4', '#00C9A7'], accent: '#ffffff', text: '#0A0B1E' },
      
      // VIOOH Purple/Magenta
      { bg: ['#6B3FA0', '#4A2875'], accent: '#00C9A7', text: '#ffffff' },
      { bg: ['#E91E8C', '#6B3FA0'], accent: '#ffffff', text: '#ffffff' },
      { bg: ['#6B3FA0', '#E91E8C'], accent: '#00C9A7', text: '#ffffff' },
      
      // VIOOH Dark/Premium
      { bg: ['#0A0B1E', '#1A1B3E'], accent: '#00C9A7', text: '#ffffff' },
      { bg: ['#060714', '#0A0B1E'], accent: '#E91E8C', text: '#ffffff' },
      { bg: ['#1A1B3E', '#2A2B4E'], accent: '#00D4D4', text: '#ffffff' },
      
      // VIOOH Mixed
      { bg: ['#0A0B1E', '#6B3FA0'], accent: '#00C9A7', text: '#ffffff' },
      { bg: ['#00C9A7', '#E91E8C'], accent: '#ffffff', text: '#ffffff' },
      { bg: ['#6B3FA0', '#00C9A7'], accent: '#E91E8C', text: '#ffffff' },
      
      // Teal to Navy
      { bg: ['#00C9A7', '#0A0B1E'], accent: '#E91E8C', text: '#ffffff' },
      { bg: ['#0A0B1E', '#00C9A7'], accent: '#FFB800', text: '#ffffff' },
      
      // Vibrant variations
      { bg: ['#00E896', '#00C9A7'], accent: '#6B3FA0', text: '#0A0B1E' },
    ];
    return palettes[Math.floor(Math.random() * palettes.length)];
  }

  // Generate random geometric shapes
  generateShapes(ctx, palette, count = 15) {
    for (let i = 0; i < count; i++) {
      const shapeType = Math.floor(Math.random() * 4);
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      const size = Math.random() * 150 + 30;
      
      ctx.save();
      ctx.globalAlpha = Math.random() * 0.3 + 0.05;
      ctx.fillStyle = palette.accent;
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;

      switch (shapeType) {
        case 0: // Circle
          ctx.beginPath();
          ctx.arc(x, y, size / 2, 0, Math.PI * 2);
          Math.random() > 0.5 ? ctx.fill() : ctx.stroke();
          break;
        case 1: // Square
          ctx.translate(x, y);
          ctx.rotate(Math.random() * Math.PI);
          Math.random() > 0.5 
            ? ctx.fillRect(-size/2, -size/2, size, size)
            : ctx.strokeRect(-size/2, -size/2, size, size);
          break;
        case 2: // Triangle
          ctx.beginPath();
          ctx.translate(x, y);
          ctx.rotate(Math.random() * Math.PI);
          ctx.moveTo(0, -size/2);
          ctx.lineTo(size/2, size/2);
          ctx.lineTo(-size/2, size/2);
          ctx.closePath();
          Math.random() > 0.5 ? ctx.fill() : ctx.stroke();
          break;
        case 3: // Line
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(Math.random() * Math.PI * 2) * size * 2, 
                     y + Math.sin(Math.random() * Math.PI * 2) * size * 2);
          ctx.lineWidth = Math.random() * 8 + 2;
          ctx.stroke();
          break;
      }
      ctx.restore();
    }
  }

  // Generate floating dots/particles
  generateParticles(ctx, palette, count = 30) {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * this.width;
      const y = Math.random() * this.height;
      const size = Math.random() * 6 + 2;
      
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = Math.random() * 0.5 + 0.2;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Word wrap text
  wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  // Generate the ad image
  generate(canvas, message, winnerName) {
    const ctx = canvas.getContext('2d');
    canvas.width = this.width;
    canvas.height = this.height;
    
    const palette = this.generatePalette();

    // Draw gradient background
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, palette.bg[0]);
    gradient.addColorStop(1, palette.bg[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    // Add geometric shapes
    this.generateShapes(ctx, palette);
    
    // Add particles
    this.generateParticles(ctx, palette);

    // Add a subtle vignette
    const vignette = ctx.createRadialGradient(
      this.width/2, this.height/2, this.height * 0.2,
      this.width/2, this.height/2, this.height * 0.8
    );
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);

    // Draw winner badge at top
    ctx.fillStyle = palette.accent;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.roundRect(this.width/2 - 120, 30, 240, 50, 25);
    ctx.fill();
    ctx.globalAlpha = 1;
    
    ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = palette.bg[0];
    ctx.textAlign = 'center';
    ctx.fillText('🏆 WINNER', this.width/2, 63);

    // Draw winner name
    ctx.font = 'bold 42px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = palette.text;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;
    ctx.fillText(winnerName, this.width/2, 140);
    ctx.shadowBlur = 0;

    // Draw main message
    ctx.font = 'bold 56px "Segoe UI", Arial, sans-serif';
    const lines = this.wrapText(ctx, message, this.width - 100);
    const lineHeight = 70;
    const totalHeight = lines.length * lineHeight;
    const startY = (this.height - totalHeight) / 2 + 40;

    // Draw text background
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.roundRect(40, startY - 50, this.width - 80, totalHeight + 60, 20);
    ctx.fill();

    // Draw text
    ctx.fillStyle = palette.text;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 15;
    lines.forEach((line, i) => {
      ctx.fillText(line, this.width/2, startY + i * lineHeight);
    });
    ctx.shadowBlur = 0;

    // Draw "AD" badge
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('PROGRAMMATIC AD', this.width/2, this.height - 40);

    // Draw decorative corners
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.7;
    
    // Top left
    ctx.beginPath();
    ctx.moveTo(20, 80);
    ctx.lineTo(20, 20);
    ctx.lineTo(80, 20);
    ctx.stroke();
    
    // Top right
    ctx.beginPath();
    ctx.moveTo(this.width - 20, 80);
    ctx.lineTo(this.width - 20, 20);
    ctx.lineTo(this.width - 80, 20);
    ctx.stroke();
    
    // Bottom left
    ctx.beginPath();
    ctx.moveTo(20, this.height - 80);
    ctx.lineTo(20, this.height - 20);
    ctx.lineTo(80, this.height - 20);
    ctx.stroke();
    
    // Bottom right
    ctx.beginPath();
    ctx.moveTo(this.width - 20, this.height - 80);
    ctx.lineTo(this.width - 20, this.height - 20);
    ctx.lineTo(this.width - 80, this.height - 20);
    ctx.stroke();
    
    ctx.globalAlpha = 1;

    return canvas.toDataURL('image/png');
  }
}

// Export for use
if (typeof module !== 'undefined') {
  module.exports = AdGenerator;
}

