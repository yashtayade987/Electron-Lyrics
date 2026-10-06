export interface AnimationPoint {
    Time: number;
    Value: number;
}

/**
 * High-performance, zero-dependency Natural Cubic Spline interpolator.
 * Matches the exact behavior and spline math of Spicy Lyrics 6.3.153 (cubic-spline).
 */
export class CubicSpline {
    private x: number[];
    private y: number[];
    private m: number[];

    constructor(points: AnimationPoint[]) {
        const sorted = [...points].sort((a, b) => a.Time - b.Time);
        const n = sorted.length;
        this.x = sorted.map((p) => p.Time);
        this.y = sorted.map((p) => p.Value);

        if (n < 2) {
            this.m = [0];
            return;
        }

        const h: number[] = new Array(n - 1);
        for (let i = 0; i < n - 1; i++) {
            h[i] = this.x[i + 1] - this.x[i];
        }

        // Tridiagonal system setup for second derivatives (M)
        const alpha: number[] = new Array(n).fill(0);
        for (let i = 1; i < n - 1; i++) {
            alpha[i] = (3 / h[i]) * (this.y[i + 1] - this.y[i]) - (3 / h[i - 1]) * (this.y[i] - this.y[i - 1]);
        }

        const l: number[] = new Array(n).fill(1);
        const mu: number[] = new Array(n).fill(0);
        const z: number[] = new Array(n).fill(0);

        for (let i = 1; i < n - 1; i++) {
            l[i] = 2 * (this.x[i + 1] - this.x[i - 1]) - h[i - 1] * mu[i - 1];
            mu[i] = h[i] / l[i];
            z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
        }

        const c: number[] = new Array(n).fill(0);
        for (let j = n - 2; j >= 0; j--) {
            c[j] = z[j] - mu[j] * c[j + 1];
        }

        this.m = c.map((v) => v * 2);
    }

    at(t: number): number {
        const n = this.x.length;
        if (n === 0) return 0;
        if (n === 1) return this.y[0];
        if (t <= this.x[0]) return this.y[0];
        if (t >= this.x[n - 1]) return this.y[n - 1];

        // Binary search for the active interval
        let low = 0;
        let high = n - 2;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (this.x[mid + 1] <= t) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        const i = low;
        const h = this.x[i + 1] - this.x[i];
        if (h <= 0) return this.y[i];

        const dx = t - this.x[i];
        const t1 = (this.x[i + 1] - t) / h;
        const t2 = dx / h;

        const a = t1;
        const b = t2;
        const c = ((t1 * t1 * t1 - t1) * (h * h)) / 6;
        const d = ((t2 * t2 * t2 - t2) * (h * h)) / 6;

        return a * this.y[i] + b * this.y[i + 1] + c * this.m[i] + d * this.m[i + 1];
    }
}
