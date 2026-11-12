// Type declarations for fluent-ffmpeg
declare module 'fluent-ffmpeg' {
  import { Readable } from 'stream';

  interface FfmpegCommand {
    input(input: string | Buffer | Readable): FfmpegCommand;
    output(output: string): FfmpegCommand;
    addInput(input: string | Buffer | Readable): FfmpegCommand;
    addOutput(output: string): FfmpegCommand;
    videoCodec(codec: string): FfmpegCommand;
    audioCodec(codec: string): FfmpegCommand;
    size(size: string): FfmpegCommand;
    aspect(aspect: string): FfmpegCommand;
    videoBitrate(bitrate: string | number): FfmpegCommand;
    audioBitrate(bitrate: string | number): FfmpegCommand;
    fps(fps: number): FfmpegCommand;
    audioFilters(filters: string | string[]): FfmpegCommand;
    videoFilters(filters: string | string[]): FfmpegCommand;
    outputOptions(options: string | string[]): FfmpegCommand;
    inputOptions(options: string | string[]): FfmpegCommand;
    format(format: string): FfmpegCommand;
    seekInput(time: string): FfmpegCommand;
    frames(count: number): FfmpegCommand;
    on(event: 'start', callback: (commandLine: string) => void): FfmpegCommand;
    on(event: 'progress', callback: (progress: { percent: number; timemark: string; targetSize: number }) => void): FfmpegCommand;
    on(event: 'end', callback: (stdout: string, stderr: string) => void): FfmpegCommand;
    on(event: 'error', callback: (err: Error, stdout: string, stderr: string) => void): FfmpegCommand;
    on(event: 'codecData', callback: (data: any) => void): FfmpegCommand;
    save(path: string): FfmpegCommand;
    pipe(stream: NodeJS.WritableStream, options?: { end: boolean }): NodeJS.ReadableStream;
    run(): FfmpegCommand;
  }

  interface FfmpegModule {
    (input?: string | Buffer | Readable): FfmpegCommand;
    setFfmpegPath(path: string): void;
    setFfprobePath(path: string): void;
    ffprobe(input: string | Buffer, callback?: (err: Error | null, data: any) => void): Promise<any>;
  }

  const ffmpeg: FfmpegModule;
  export = ffmpeg;
}

declare module 'ffmpeg-static' {
  const path: string;
  export default path;
}