import io
import unittest
from convert_external_csv import convert
class TestConverter(unittest.TestCase):
    def setUp(self):
        self.m={"schema":"imas-e2-external-v1","groups":[1,1],"agentIds":[["A"],["B"]]}
        self.header="id,incident,split,time,x,labelTime,A,B\n"
    def test_missing_values_are_not_zero(self):
        rows=convert(self.m,io.StringIO(self.header+"r,i,test,10,,,0,\n"))
        self.assertEqual(rows[0]["agents"],[[0],[None]])
        self.assertIsNone(rows[0]["x"])
        self.assertIsNone(rows[0]["labelTime"])
    def test_invalid_values_rejected(self):
        for row in ("r,i,test,10,2,10,0,1\n","r,i,test,nan,0,10,0,1\n","r,i,test,10,0,10,0\n"):
            with self.assertRaises(ValueError):convert(self.m,io.StringIO(self.header+row))
    def test_unmapped_columns_rejected(self):
        with self.assertRaises(ValueError):convert(self.m,io.StringIO(self.header.strip()+",C\n"))
if __name__=="__main__":unittest.main()
