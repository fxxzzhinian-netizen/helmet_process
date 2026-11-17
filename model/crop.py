"""Find which part of the wide view a zoomed view shows, for stacked two-panel captures.

The top panel of a 4096 x 6336 capture is a rectangle of the bottom panel, enlarged. Near an edge of
the bottom panel the rectangle is cut short and stretched, so width and height scale separately."""
import cv2
import numpy as np

REDUCTION = 4  # Features are matched on a quarter-size greyscale decode.
MATCH_RATIO = 0.75  # Lowe ratio test between the best and second-best descriptor match.
REPROJECTION = 2  # RANSAC tolerance in reduced pixels.
# Acceptance limits. A wrong window is worse than none, so every one of them must hold.
MIN_INLIERS = 20
MIN_INLIER_RATIO = 0.6
MAX_SHEAR = 0.005  # Off-diagonal terms. The window is never rotated or skewed.
SCALE_RANGE = (0.35, 0.70)  # Window size over panel size, per axis. Uncut windows measure 0.61.
EDGE_TOLERANCE = 16  # Image pixels a window may overshoot the wide panel before it is clipped to it.


def fit(path, zoomed, wide):
    """Match features of the two panels. Return (affine zoomed -> wide in reduced pixels, inliers, matches)."""
    # The released entry ignores EXIF orientation, so boxes and this window share one pixel grid.
    gray = cv2.imdecode(np.fromfile(path, dtype=np.uint8),
                        cv2.IMREAD_REDUCED_GRAYSCALE_4 | cv2.IMREAD_IGNORE_ORIENTATION)
    if gray is None:
        raise ValueError("定位截取窗口时无法读取图片")
    sift = cv2.SIFT_create(nfeatures=3000)
    features = []
    for box in (zoomed, wide):
        x1, y1, x2, y2 = (v // REDUCTION for v in box)
        features.append(sift.detectAndCompute(gray[y1:y2, x1:x2], None))
    (points_a, desc_a), (points_b, desc_b) = features
    if desc_a is None or desc_b is None or len(points_b) < 2:
        return None, 0, 0
    pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(desc_a, desc_b, k=2)
    good = [a for a, b in pairs if a.distance < MATCH_RATIO * b.distance]
    if len(good) < 3:
        return None, 0, len(good)
    source = np.float32([points_a[m.queryIdx].pt for m in good])
    target = np.float32([points_b[m.trainIdx].pt for m in good])
    # Not a similarity transform: a window cut short at an edge is stretched along one axis.
    cv2.setRNGSeed(0)  # RANSAC samples at random. The same picture must always give the same window.
    matrix, mask = cv2.estimateAffine2D(source, target, method=cv2.RANSAC,
                                        ransacReprojThreshold=REPROJECTION)
    return matrix, int(mask.sum()) if matrix is not None else 0, len(good)


def locate_crop(path, zoomed, wide):
    """Return [x1, y1, x2, y2] in image pixels, the part of `wide` shown by `zoomed`, or None."""
    matrix, inliers, matches = fit(path, zoomed, wide)
    if matrix is None or inliers < MIN_INLIERS or inliers < MIN_INLIER_RATIO * matches:
        return None
    (scale_x, shear_x, shift_x), (shear_y, scale_y, shift_y) = matrix.tolist()
    low, high = SCALE_RANGE
    if max(abs(shear_x), abs(shear_y)) > MAX_SHEAR or not (low <= scale_x <= high and low <= scale_y <= high):
        return None
    x1 = wide[0] + shift_x * REDUCTION
    y1 = wide[1] + shift_y * REDUCTION
    x2 = x1 + scale_x * (zoomed[2] - zoomed[0])
    y2 = y1 + scale_y * (zoomed[3] - zoomed[1])
    if (x1 < wide[0] - EDGE_TOLERANCE or y1 < wide[1] - EDGE_TOLERANCE
            or x2 > wide[2] + EDGE_TOLERANCE or y2 > wide[3] + EDGE_TOLERANCE):
        return None
    return [max(x1, wide[0]), max(y1, wide[1]), min(x2, wide[2]), min(y2, wide[3])]


def mark_crop(panels, path):
    """On a stacked top/bottom capture, record on the top panel which part of the bottom panel it shows."""
    if [panel["id"] for panel in panels] != ["top", "bottom"]:
        return
    top, bottom = panels
    box = locate_crop(path, top["box"], bottom["box"])
    if box:
        top.update(crop_of="bottom", source_box=box)
