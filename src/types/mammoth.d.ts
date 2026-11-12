declare module "mammoth" {
  interface ExtractRawTextOptions {
    buffer?: Buffer;
    arrayBuffer?: ArrayBuffer;
    path?: string;
    styleMap?: string;
    styleMaps?: string;
  }

  interface ExtractRawTextResult {
    value: string;
    message: string;
  }

  interface Mammoth {
    extractRawText(options: ExtractRawTextOptions): Promise<ExtractRawTextResult>;
  }

  const mammoth: Mammoth;
  export default mammoth;
}