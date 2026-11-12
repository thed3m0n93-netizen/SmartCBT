declare module 'qrcode' {
  interface QRCodeToDataURLOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    type?: string;
    renderer?: string;
    width?: number;
    margin?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  interface QRCodeGenerator {
    toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
    toString(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  }

  const QRCode: QRCodeGenerator;
  export default QRCode;
}
