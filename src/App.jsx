import './App.css';
import React, { useState } from 'react';

const API_BASE_URL = 'https://testadmin-copy2.nitex.com/api/core';
const TOKEN =
  'Bearer eyJhbGciOiJIUzUxMiIsInppcCI6IkdaSVAifQ.H4sIAAAAAAAA_z3OXwuCMBQF8O9ynyX8k0k-FVQglE8-FK2HiUsvzG3MTSzxuzcVejv87j1wRuhsCSmMBGzHdPFRjEBK4Hi6ZTkBb-Ur6xnPKneJ4jByiHMOXGAtRb40WtpUGBwEGjZsULzl0qZKadlTfuG0Xt4eK1vTSI0GWef0-ZrJGI2lNYuMkxOpayrwSw1K8R-WZ8X5TmACD5AaNyLZJn4chr7vARvUCvtg52D6AX6kSArdAAAA.rcaCY9rrfrtuvsL_TOMlp3ss1Vr24x2Pb_hYUsMhCstVVbhbCutRbcMV0vpN-2bDVv2s6VWxQpwL3v0Q5KK_Sw';

function App() {
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Add validation for file size
    if (file.size === 0) {
      setError('File is empty. Please select a valid file.');
      return;
    }

    setFile(file);
    setError(null);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    try {
      setIsUploading(true);
      setError(null);
      setUploadProgress(0);

      // Validate file size before proceeding
      if (file.size === 0) {
        throw new Error('Cannot upload an empty file');
      }

      const partSize = Math.min(5 * 1024 * 1024, file.size);
      const numParts = Math.max(1, Math.ceil(file.size / partSize));

      // Step 1: Initiate multipart upload via backend ( calls /upload/initiate-upload to get an uploadId and key)
      const initRes = await fetch(`${API_BASE_URL}/doc/multipart-upload/initiate`, {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          docMimeType: file.type,
          partCount: numParts,
          documentType: 'PRODUCT_DESIGN',
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: TOKEN,
        },
      });

      if (!initRes.ok) throw new Error('Failed to initiate upload');
      const initData = await initRes.json();
      console.log('Init response:', initData);
      const { uploadId, key } = initData;

      // Step 2: Get signed URLs for all parts ( calls /upload/get-signed-urls to get signed URLs for all parts)
      const requestBody = {
        key,
        uploadId,
        parts: numParts,
        filename: file.name,
        type: file.type,
      };

      console.log('Sending signed URLs request:', requestBody);

      const presignedRes = await fetch(`${API_BASE_URL}/upload/get-signed-urls`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json',
          Authorization: TOKEN,
        },
      });

      const responseText = await presignedRes.text();
      console.log('Raw response:', responseText);

      let responseData;
      try {
        responseData = JSON.parse(responseText);
        console.log('Parsed response:', responseData);
      } catch (e) {
        console.error('Failed to parse response:', e);
        throw new Error('Invalid response from server');
      }

      if (!presignedRes.ok) {
        throw new Error(
          `Failed to get signed URLs: ${responseData.message || presignedRes.statusText}`
        );
      }

      if (!responseData.urls) {
        console.error('Response missing urls:', responseData);
        throw new Error('No URLs received from server');
      }

      const { urls } = responseData;

      // Step 3: Upload parts ( calls /upload/upload-part for each part)
      const etags = [];
      let completedParts = 0;

      for (let i = 0; i < numParts; i++) {
        const start = i * partSize;
        const end = Math.min(start + partSize, file.size);
        const blob = file.slice(start, end);
        const { partNumber, url } = urls[i];

        const res = await fetch(url, {
          method: 'PUT',
          body: blob,
        });

        if (!res.ok) throw new Error(`Failed to upload part ${partNumber}`);

        const etag = res.headers.get('ETag');
        etags.push({ PartNumber: partNumber, ETag: etag });

        completedParts++;
        setUploadProgress((completedParts / numParts) * 100);
      }

      // Step 4: Complete upload ( calls /upload/complete-upload to complete the upload)
      const completeRes = await fetch(`${API_BASE_URL}/doc/multipart-upload/complete`, {
        method: 'POST',
        body: JSON.stringify({ key, uploadId, parts: etags }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: TOKEN,
        },
      });

      if (!completeRes.ok) throw new Error('Failed to complete upload');

      const { location } = await completeRes.json();
      alert(`Upload complete! File available at: ${location}`);
      setFile(null);
      setUploadProgress(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <main className='upload-container'>
      <section className='upload-section'>
        <h1>File Upload</h1>
        <form onSubmit={handleUpload}>
          <div className='file-input-container'>
            <input
              type='file'
              onChange={handleFileChange}
              name='file'
              id='file'
              disabled={isUploading}
            />
            {file && (
              <div className='file-info'>
                <p>Selected file: {file.name}</p>
                <p>Size: {(file.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            )}
          </div>

          {error && <div className='error-message'>{error}</div>}

          {isUploading && (
            <div className='progress-container'>
              <div className='progress-bar' style={{ width: `${uploadProgress}%` }} />
              <span>{Math.round(uploadProgress)}%</span>
            </div>
          )}

          <div className='button-container'>
            <button type='submit' disabled={!file || isUploading}>
              {isUploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export default App;
