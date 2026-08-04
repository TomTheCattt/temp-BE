declare module 'node-cron' {
  interface ScheduledTask { stop(): void; start(): void; }
  export function schedule(expression: string, callback: () => void | Promise<void>): ScheduledTask;
  const cron: { schedule: typeof schedule };
  export default cron;
}
