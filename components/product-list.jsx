// src/components/product-list.jsx
import Link from "next/link";
import { Button } from "@/components/ui/button"; // Adjust path based on Shadcn setup
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusIndicator } from "./status-indicator"; // Import status indicator

export function ProductList({ products = [] }) {
  if (!products || products.length === 0) {
    return (
      <p className="text-muted-foreground">
        No product folders found in input directory.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {products.map((product) => (
        <Card key={product.sanitizedName} className="flex flex-col">
          <CardHeader>
            <CardTitle
              className="text-lg truncate"
              title={product.originalName}
            >
              {product.originalName}
            </CardTitle>
            <CardDescription>
              {product.sanitizedName}{" "}
              {product.is_configured ? "(Configured)" : "(Not Configured)"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            {/* Display more info if needed, e.g., title from config */}
            <p className="text-sm text-muted-foreground">
              Title:{" "}
              <span className="font-medium text-foreground">
                {product.title}
              </span>
            </p>
          </CardContent>
          <CardFooter className="flex justify-between items-center">
            <StatusIndicator isProcessing={product.isProcessing} />
            <Button asChild size="sm" disabled={product.isProcessing}>
              <Link
                href={`/configure/${encodeURIComponent(product.originalName)}`} // Link using ORIGINAL name
                aria-disabled={product.isProcessing}
                onClick={(e) => {
                  if (product.isProcessing) e.preventDefault();
                }} // Prevent click if disabled
              >
                Configure & Process
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
