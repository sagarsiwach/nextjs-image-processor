// app/page.jsx
import fs from 'node:fs/promises';
import path from 'node:path';
import * as Config from '@/lib/config'; // Use alias configured in jsconfig.json
import * as ProductIO from '@/lib/product-io'; // Import helper functions
import * as Status from '@/lib/status'; // To check initial processing status
import { ProductList } from '@/components/product-list'; // Import the display component
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'; // Use Card for layout


// This page will be dynamically rendered on each request to get fresh data
export const dynamic = 'force-dynamic';
// Opt out of caching for this page if needed, especially if status changes frequently
// export const revalidate = 0; // Or a specific time in seconds


async function getProductsData() {
    let productsData = [];
    let error = null;
    try {
        const productFolders = await ProductIO.listProductFolders(); // Uses fs from node

        // For each folder, get its config and status
        productsData = await Promise.all(
            productFolders.map(async (folder) => {
                const sanitizedName = (await import('@/lib/utils')).sanitizeName(folder.name); // Use utils for sanitization
                const config = await ProductIO.loadLocalProcessorConfig(folder.name); // Load config using original name
                const isProcessing = Status.isProductProcessing(sanitizedName); // Check status using sanitized name

                return {
                    originalName: folder.name,
                    sanitizedName: sanitizedName,
                    isConfigured: await Bun.file(ProductIO.getLocalConfigFilePath(folder.name)).exists(), // Check if config file exists
                    title: config.title || Config.DEFAULT_TITLE,
                    isProcessing: isProcessing,
                };
            })
        );

    } catch (err) {
        console.error("Error fetching product data for main page:", err);
        // Assign error message to display on the page
        error = `Failed to load product list from ${Config.INPUT_DIR}. Check console logs.`;
        // Log the error to the status module as well
        Status.addErrorLog(`Error loading products for page.jsx: ${err.message}`, false); // Non-critical for page load itself
    }
    return { productsData, error };
}


export default async function HomePage() {
    const { productsData, error } = await getProductsData();

    return (
        <main className="container mx-auto p-4 py-8 md:p-8">
            <Card className="mb-6 border-blue-200 bg-blue-50/50">
                 <CardHeader>
                     <CardTitle className="text-2xl text-blue-900">Image Processor Control Panel</CardTitle>
                     <CardDescription className="text-blue-700">
                         Configure product variants, set hotspots, and process images for S3 upload.
                     </CardDescription>
                 </CardHeader>
                 <CardContent className="text-sm text-blue-800 space-y-1">
                     <p><strong className="font-medium">Input Directory:</strong> <code className="bg-blue-100 px-1 rounded text-xs">{Config.INPUT_DIR}</code></p>
                     <p><strong className="font-medium">Output JSON Directory:</strong> <code className="bg-blue-100 px-1 rounded text-xs">{Config.OUTPUT_JSON_DIR}</code></p>
                     <p><strong className="font-medium">Target S3 Bucket:</strong> <code className="bg-blue-100 px-1 rounded text-xs">{Config.S3_BUCKET || 'Not Set!'}</code></p>
                 </CardContent>
            </Card>

            <h2 className="text-xl font-semibold mb-4 text-gray-700">Available Products</h2>

            {error && (
                <Card className="mb-4 border-destructive bg-destructive/10">
                    <CardHeader>
                        <CardTitle className="text-destructive text-lg">Error Loading Products</CardTitle>
                    </CardHeader>
                    <CardContent className="text-destructive/90 text-sm">
                        {error}
                    </CardContent>
                </Card>
            )}

            <ProductList products={productsData} />

        </main>
    );
}