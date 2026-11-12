/**
 * Media Upload Load Test
 * Tests TUS resumable upload, multipart upload, presigned URLs
 * Target: p95 < 500ms for upload initiation, 10k concurrent
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { BASE_URL, commonHeaders, getAuthHeaders, randomInt, sleepRandom } from './k6-config.js';

// Custom metrics
const uploadRequests = new Counter('upload_requests_total');
const uploadErrors = new Rate('upload_errors');
const uploadLatency = new Trend('upload_latency', true);
const tusCreateLatency = new Trend('tus_create_latency', true);
const tusUploadLatency = new Trend('tus_upload_latency', true);
const presignedLatency = new Trend('presigned_latency', true);
const uploadThroughput = new Trend('upload_throughput_mbps', true);

// Endpoints
const ENDPOINTS = {
  tusCreate: '/v1/upload/tus/',
  tusUpload: (id) => `/v1/upload/tus/${id}`,
  multipart: '/v1/upload/multipart',
  presigned: '/v1/upload/presigned',
  tusHead: (id) => `/v1/upload/tus/${id}`,
};

// Mock file sizes for testing (in bytes)
const FILE_SIZES = {
  small: 100 * 1024,      // 100 KB - image
  medium: 5 * 1024 * 1024, // 5 MB - large image/small video
  large: 50 * 1024 * 1024, // 50 MB - video
};

export function setup() {
  const users = [];
  for (let i = 0; i < 1000; i++) {
    users.push({
      token: `test-token-${i}`,
    });
  }
  return { users };
}

// Generate mock file data
function generateMockFile(size) {
  // Create a buffer of random data
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < size; i++) {
    view[i] = Math.floor(Math.random() * 256);
  }
  return buffer;
}

export default function (data) {
  const user = data.users[__VU % data.users.length];
  const headers = getAuthHeaders(user.token);

  // Test 1: TUS Resumable Upload (50% of iterations)
  if (__ITER % 2 === 0) {
    group('TUS Upload', () => {
      const fileSize = FILE_SIZES[['small', 'medium', 'large'][randomInt(0, 2)]];
      const fileName = `test-${__VU}-${__ITER}.jpg`;
      const mimeType = 'image/jpeg';

      // Step 1: Create TUS upload (POST with Upload-Length)
      group('TUS Create', () => {
        const createHeaders = {
          ...headers,
          'Upload-Length': fileSize.toString(),
          'Upload-Metadata': `filename ${btoa(fileName)},filetype ${btoa(mimeType)}`,
          'Tus-Resumable': '1.0.0',
        };

        const startTime = new Date();
        const response = http.post(`${BASE_URL}${ENDPOINTS.tusCreate}`, null, {
          headers: createHeaders,
          tags: { type: 'media', operation: 'tus_create' },
          timeout: '15s',
        });
        const latency = new Date() - startTime;

        uploadRequests.add(1, { operation: 'tus_create' });
        tusCreateLatency.add(latency);
        uploadLatency.add(latency);

        let uploadUrl = null;
        const success = check(response, {
          'tus create status 201': (r) => r.status === 201,
          'tus create has Location header': (r) => {
            uploadUrl = r.headers['Location'];
            return uploadUrl !== undefined;
          },
          'tus create latency < 500ms': () => latency < 500,
        });

        uploadErrors.add(!success, { operation: 'tus_create' });

        if (!success || !uploadUrl) {
          return;
        }

        sleepRandom(100, 500);

        // Step 2: Upload file in chunks (simulate resumable)
        group('TUS Upload Chunks', () => {
          const chunkSize = 1024 * 1024; // 1 MB chunks
          const chunks = Math.ceil(fileSize / chunkSize);
          let offset = 0;

          for (let i = 0; i < chunks; i++) {
            const currentChunkSize = Math.min(chunkSize, fileSize - offset);
            const mockData = generateMockFile(currentChunkSize);

            const uploadHeaders = {
              ...headers,
              'Content-Type': 'application/offset+octet-stream',
              'Upload-Offset': offset.toString(),
              'Tus-Resumable': '1.0.0',
            };

            const uploadStart = new Date();
            const uploadResponse = http.patch(uploadUrl, mockData, {
              headers: uploadHeaders,
              tags: { type: 'media', operation: 'tus_upload_chunk' },
              timeout: '30s',
            });
            const uploadLatency = new Date() - uploadStart;

            uploadRequests.add(1, { operation: 'tus_upload_chunk' });
            tusUploadLatency.add(uploadLatency);
            uploadLatency.add(uploadLatency);

            const uploadSuccess = check(uploadResponse, {
              'tus chunk status 204': (r) => r.status === 204,
              'tus chunk updates offset': (r) => {
                const newOffset = parseInt(r.headers['Upload-Offset'], 10);
                return newOffset === offset + currentChunkSize;
              },
            });

            uploadErrors.add(!uploadSuccess, { operation: 'tus_upload_chunk' });

            if (!uploadSuccess) {
              break;
            }

            offset += currentChunkSize;

            // Simulate network variability
            sleepRandom(50, 200);
          }

          // Verify upload completion with HEAD request
          if (offset === fileSize) {
            group('TUS Verify', () => {
              const headHeaders = {
                ...headers,
                'Tus-Resumable': '1.0.0',
              };

              const headResponse = http.head(uploadUrl, {
                headers: headHeaders,
                tags: { type: 'media', operation: 'tus_verify' },
                timeout: '10s',
              });

              check(headResponse, {
                'tus verify status 200': (r) => r.status === 200,
                'tus verify has correct length': (r) => {
                  const length = parseInt(r.headers['Upload-Length'], 10);
                  return length === fileSize;
                },
                'tus verify offset matches': (r) => {
                  const offset = parseInt(r.headers['Upload-Offset'], 10);
                  return offset === fileSize;
                },
              });
            });
          }

          // Calculate throughput
          const totalTime = (new Date() - startTime) / 1000; // seconds
          const throughputMbps = (fileSize / (1024 * 1024)) / totalTime * 8;
          uploadThroughput.add(throughputMbps);
        });
      });

      sleepRandom(2000, 5000);
    });
  }

  // Test 2: Multipart Upload (20% of iterations)
  if (__ITER % 5 === 0) {
    group('Multipart Upload', () => {
      const fileSize = FILE_SIZES.small; // Multipart for smaller files
      const fileName = `multipart-${__VU}-${__ITER}.jpg`;
      const mimeType = 'image/jpeg';
      const mockData = generateMockFile(fileSize);

      const formData = {
        file: http.file(mockData, fileName, mimeType),
        type: 'image',
      };

      const startTime = new Date();
      const response = http.post(`${BASE_URL}${ENDPOINTS.multipart}`, formData, {
        headers,
        tags: { type: 'media', operation: 'multipart' },
        timeout: '30s',
      });
      const latency = new Date() - startTime;

      uploadRequests.add(1, { operation: 'multipart' });
      uploadLatency.add(latency);

      const success = check(response, {
        'multipart status 201': (r) => r.status === 201,
        'multipart returns media id': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.mediaId !== undefined;
          } catch {
            return false;
          }
        },
        'multipart latency < 1000ms': () => latency < 1000,
      });

      uploadErrors.add(!success, { operation: 'multipart' });

      const throughputMbps = (fileSize / (1024 * 1024)) / (latency / 1000) * 8;
      uploadThroughput.add(throughputMbps);

      sleepRandom(1000, 3000);
    });
  }

  // Test 3: Presigned URL Upload (30% of iterations)
  if (__ITER % 10 < 3) {
    group('Presigned URL Upload', () => {
      const fileSize = FILE_SIZES[['small', 'medium'][randomInt(0, 1)]];
      const fileName = `presigned-${__VU}-${__ITER}.jpg`;
      const mimeType = 'image/jpeg';

      // Step 1: Get presigned URL
      group('Get Presigned URL', () => {
        const presignedData = {
          fileName,
          mimeType,
          fileSize,
          type: 'image',
        };

        const startTime = new Date();
        const response = http.post(`${BASE_URL}${ENDPOINTS.presigned}`, JSON.stringify(presignedData), {
          headers,
          tags: { type: 'media', operation: 'presigned_get' },
          timeout: '10s',
        });
        const latency = new Date() - startTime;

        uploadRequests.add(1, { operation: 'presigned_get' });
        presignedLatency.add(latency);
        uploadLatency.add(latency);

        let presignedUrl = null;
        let mediaId = null;
        const success = check(response, {
          'presigned get status 200': (r) => r.status === 200,
          'presigned get returns url': (r) => {
            try {
              const body = JSON.parse(r.body);
              presignedUrl = body.uploadUrl;
              mediaId = body.mediaId;
              return presignedUrl !== undefined;
            } catch {
              return false;
            }
          },
          'presigned get latency < 300ms': () => latency < 300,
        });

        uploadErrors.add(!success, { operation: 'presigned_get' });

        if (!success || !presignedUrl) {
          return;
        }

        sleepRandom(100, 300);

        // Step 2: Upload directly to S3
        group('Upload to S3', () => {
          const mockData = generateMockFile(fileSize);

          const s3Headers = {
            'Content-Type': mimeType,
            'Content-Length': fileSize.toString(),
          };

          const uploadStart = new Date();
          const uploadResponse = http.put(presignedUrl, mockData, {
            headers: s3Headers,
            tags: { type: 'media', operation: 'presigned_upload' },
            timeout: '60s',
          });
          const uploadLatency = new Date() - uploadStart;

          uploadRequests.add(1, { operation: 'presigned_upload' });
          uploadLatency.add(uploadLatency);

          const uploadSuccess = check(uploadResponse, {
            's3 upload status 200': (r) => r.status === 200,
          });

          uploadErrors.add(!uploadSuccess, { operation: 'presigned_upload' });

          const throughputMbps = (fileSize / (1024 * 1024)) / (uploadLatency / 1000) * 8;
          uploadThroughput.add(throughputMbps);
        });
      });

      sleepRandom(2000, 5000);
    });
  }
}

export function teardown(data) {
  console.log('Media upload load test completed');
  console.log(`Total upload requests: ${uploadRequests.count}`);
  console.log(`Error rate: ${uploadErrors.rate * 100}%`);
}