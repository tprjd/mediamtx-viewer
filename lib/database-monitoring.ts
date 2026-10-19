import { SpanStatusCode, trace } from '@opentelemetry/api'
import { databaseOperations } from './monitoring-labels'

export function monitorDatabase<T>(operation: typeof databaseOperations[number], run: () => T): T {
  return trace.getTracer('mediamtx-viewer').startActiveSpan(`database ${operation}`, { attributes: { 'db.operation.name': operation } }, span => {
    try { return run() }
    catch (error) { span.setStatus({ code: SpanStatusCode.ERROR }); throw error }
    finally { span.end() }
  })
}
