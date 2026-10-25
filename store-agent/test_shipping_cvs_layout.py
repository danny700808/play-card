import io
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, DictionaryObject, ArrayObject, NumberObject
from shipping_cvs_layout import label_bounds, normalize_cvs_pdf, LayoutError, PAPER
from shipping_preview import print_pdf, preview_pdf


def sample_pdf(*, extra=False, pages=1, rotation=0, annotation=False):
    writer = PdfWriter()
    for _ in range(pages):
        page = writer.add_blank_page(width=595.2756, height=841.8898)
        stream = DecodedStreamObject()
        # A visible synthetic label inside the upper-left quarter.
        stream.set_data(b"0 0 0 rg 40 500 220 300 re f\n" + (b"400 50 30 30 re f" if extra else b""))
        page[NameObject('/Contents')] = writer._add_object(stream)
        if rotation:
            page.rotate(rotation)
        if annotation:
            widget = DictionaryObject({NameObject('/Subtype'):NameObject('/Widget'),
                NameObject('/FT'):NameObject('/Tx'),NameObject('/F'):NumberObject(2),
                NameObject('/Rect'):ArrayObject([NumberObject(x) for x in [0,0,1,1]])})
            page[NameObject('/Annots')] = ArrayObject([writer._add_object(widget)])
    output = io.BytesIO(); writer.write(output)
    return output.getvalue()


class LayoutTests(unittest.TestCase):
    def image(self):
        image = Image.new('RGB', (1200, 1684), 'white')
        ImageDraw.Draw(image).rectangle((100,80,560,790), outline='black', width=2)
        return image

    def test_seven_keeps_entire_label(self):
        with self.image() as image:
            self.assertEqual(label_bounds(image,'seven'), (100,80,561,791))

    def test_family_accepts_only_thin_central_cut_guides(self):
        with self.image() as image:
            draw = ImageDraw.Draw(image)
            draw.line((600,30,600,1600),fill='black')
            draw.line((60,825,1060,825),fill='black')
            self.assertEqual(label_bounds(image,'family'), (100,80,561,791))

    def test_even_faint_content_outside_the_label_is_not_discarded(self):
        for method in ('seven','family'):
            with self.subTest(method=method), self.image() as image:
                ImageDraw.Draw(image).point((1000,1500), fill=(255,255,254))
                with self.assertRaises(LayoutError): label_bounds(image,method)

    def test_blank_or_boundary_label_is_rejected(self):
        with Image.new('RGB',(1200,1684),'white') as image:
            with self.assertRaises(LayoutError): label_bounds(image,'seven')
        with self.image() as image:
            ImageDraw.Draw(image).line((100,800,599,800),fill='black')
            with self.assertRaises(LayoutError): label_bounds(image,'seven')

    @patch('shipping_cvs_layout.barcode_signature', return_value=Counter({('QR','synthetic'):1}))
    def test_pdf_is_single_page_with_translation_only_and_idempotent(self, barcode):
        original = sample_pdf()
        result, meta = normalize_cvs_pdf(original,'seven')
        page = PdfReader(io.BytesIO(result)).pages[0]
        self.assertEqual(len(PdfReader(io.BytesIO(result)).pages), 1)
        self.assertAlmostEqual(float(page.mediabox.width),PAPER[0],places=5)
        self.assertAlmostEqual(float(page.mediabox.height),PAPER[1],places=5)
        transforms=[operands for operands,op in page.get_contents().operations if op==b'cm']
        self.assertTrue(transforms)
        for operands in transforms: self.assertEqual(list(operands[:4]),[1,0,0,1])
        self.assertEqual(meta['scale'],1)
        again, second_meta = normalize_cvs_pdf(result,'seven')
        self.assertEqual(result,again)
        self.assertTrue(second_meta['alreadyNormalized'])
        self.assertAlmostEqual(float(PdfReader(io.BytesIO(original)).pages[0].mediabox.width),595.2756)

    @patch('shipping_cvs_layout.barcode_signature', return_value=Counter({('QR','synthetic'):1}))
    def test_reject_multiple_labels_rotated_pages_and_multiple_pages(self, barcode):
        for options in ({'extra':True},{'rotation':90},{'pages':2}):
            with self.subTest(options=options),self.assertRaises(LayoutError):
                normalize_cvs_pdf(sample_pdf(**options),'seven')

    @patch('shipping_cvs_layout.barcode_signature', return_value=Counter({('QR','synthetic'):1}))
    def test_only_verified_family_hidden_metadata_widgets_are_allowed(self, barcode):
        source=sample_pdf(annotation=True)
        result,_=normalize_cvs_pdf(source,'family')
        self.assertFalse(PdfReader(io.BytesIO(result)).pages[0].get('/Annots'))
        self.assertTrue(PdfReader(io.BytesIO(source)).pages[0].get('/Annots'))
        with self.assertRaises(LayoutError):normalize_cvs_pdf(source,'seven')

    def test_unreadable_or_missing_barcode_prevents_output(self):
        for signatures in ([Counter()], [Counter({('QR','original'):1}),Counter({('QR','different'):1})]):
            with patch('shipping_cvs_layout.barcode_signature',side_effect=signatures):
                with self.assertRaises(LayoutError):normalize_cvs_pdf(sample_pdf(),'seven')

    @patch('shipping_cvs_layout.barcode_signature', return_value=Counter({('QR','synthetic'):1}))
    def test_preview_and_print_use_same_normalized_pdf_while_home_stays_a4(self, barcode):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'document-settings.json').write_text('{"momoPdfPassword":"test"}')
            source=sample_pdf()
            for method in ('seven','family'):
                row={'platform':'MOMO','shippingMethod':method}
                content=print_pdf(source,root,row)
                self.assertTrue(content)
                with Image.open(io.BytesIO(preview_pdf(source,root,row))) as image:
                    self.assertEqual(image.size,(567,851))
            home=print_pdf(source,root,{'platform':'MOMO','shippingMethod':'third'})
            page=PdfReader(io.BytesIO(home)).pages[0]
            self.assertAlmostEqual(float(page.mediabox.width),595.2756,places=2)
            self.assertIsNone(print_pdf(source,root,{'platform':'EasyStore'}))


if __name__=='__main__':unittest.main()
